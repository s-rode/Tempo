#import "activeWindowObserver.h"
#import "sleepAndLockObserver.h"
#import "browserTabUtils.h"
#import "chromeTabTracking.h"
#import "iconUtils.h"
#import "appFilter.h"
#import "titleExtractor.h"
#include <iostream>
#include <stdio.h> // For fprintf, stderr
#include <stdarg.h>
#import <CoreGraphics/CoreGraphics.h>
#import <os/log.h>
#import <ApplicationServices/ApplicationServices.h>
#import <Cocoa/Cocoa.h>
#import <dispatch/dispatch.h>

// Captured titles, URLs and page evidence are never written to native logs.
#define MyLog(...) do {} while (0)

Napi::ThreadSafeFunction activeWindowChangedCallback;
ActiveWindowObserver *windowObserver;

auto napiCallback = [](Napi::Env env, Napi::Function jsCallback, std::string* data) {
    // Abort drains queued payloads without a usable JavaScript environment.
    if (env != nullptr && !jsCallback.IsEmpty())
        jsCallback.Call({Napi::String::New(env, *data)});
    delete data;
};

void windowChangeCallback(AXObserverRef observer, AXUIElementRef element, CFStringRef notificationName, void *refCon) {
    if (CFStringCompare(notificationName, kAXMainWindowChangedNotification, 0) == kCFCompareEqualTo ||
        CFStringCompare(notificationName, kAXFocusedWindowChangedNotification, 0) == kCFCompareEqualTo) {
        NSTimeInterval delayInMSec = 30;
        dispatch_time_t popTime = dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delayInMSec * NSEC_PER_MSEC));
        ActiveWindowObserver *observerRef = (ActiveWindowObserver *)refCon;
        dispatch_after(popTime, dispatch_get_main_queue(), ^(void){
            MyLog(@"mainWindowChanged");
            [observerRef scheduleCaptureForCurrentFrontmostWindowWithReason:@"window_change"];
        });
    }
}

@implementation ActiveWindowObserver {
    NSNumber *processId;
    AXObserverRef observer;
    dispatch_source_t periodicCheckSource;
    NSUInteger captureGeneration;
    NSString *lastTrackedApp;             
    NSString *lastObservedWindowSignature;
    NSTimeInterval lastAppSwitchTime;    
    BOOL isCurrentlyTracking;           
    ChromeTabTracking *chromeTabTracking;
    FirefoxTabTracking *firefoxTabTracking;
    SleepAndLockObserver *sleepAndLockObserver;
    BOOL activityCapturePaused;
    BOOL manualOrFocusPaused;
    BOOL screenLocked;
    BOOL systemSleeping;
    pid_t lastWatchdogForegroundPid;
    NSUInteger watchdogTickCount;
}

- (id)init {
    self = [super init];
    if (!self) return nil;
    
    sleepAndLockObserver = [[SleepAndLockObserver alloc] initWithWindowObserver:self];
    chromeTabTracking = [[ChromeTabTracking alloc] init];
    chromeTabTracking.delegate = self;
    firefoxTabTracking = [[FirefoxTabTracking alloc] init];
    firefoxTabTracking.delegate = self;
    
    // Get both workspace and distributed notification centers
    NSNotificationCenter *workspaceCenter = [[NSWorkspace sharedWorkspace] notificationCenter];
    
    // Workspace notifications (sleep/wake)
    [workspaceCenter addObserver:self 
                                                         selector:@selector(receiveAppChangeNotification:) 
                                                             name:NSWorkspaceDidActivateApplicationNotification 
                                                             object:nil];

    // NSWorkspace activation notifications are normally immediate. This
    // lightweight PID watchdog repairs the occasional missed notification
    // without polling OCR/content extraction or creating duplicate classifications.
    [self startPeriodicBackupTimer];
    
    MyLog(@"🔧 DEBUG: Initialized observers for sleep/wake and lock/unlock events");
    
    return self;
}

- (void)dealloc {
    [self stopPeriodicBackupTimer];
    [chromeTabTracking release];
    chromeTabTracking = nil;
    [firefoxTabTracking release];
    firefoxTabTracking = nil;
    [lastObservedWindowSignature release];
    [sleepAndLockObserver release];
    sleepAndLockObserver = nil;

    [[[NSWorkspace sharedWorkspace] notificationCenter] removeObserver:self];
    [[NSDistributedNotificationCenter defaultCenter] removeObserver:self];
    [super dealloc];
}

// periodic backup timer
- (void)startPeriodicBackupTimer {
    [self stopPeriodicBackupTimer];

    // This addon is initialized by Electron rather than a traditional AppKit
    // application. An NSTimer attached to that transient run loop can stop
    // firing, leaving the renderer stuck on the last event. A main-queue GCD
    // timer is independent of that run loop. It only compares native window
    // identity; OCR, extraction, and classification still happen only when
    // the identity changed.
    periodicCheckSource = dispatch_source_create(
        DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
    dispatch_source_set_timer(
        periodicCheckSource,
        dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC),
        NSEC_PER_SEC,
        100 * NSEC_PER_MSEC);
    __unsafe_unretained ActiveWindowObserver *observerRef = self;
    dispatch_source_set_event_handler(periodicCheckSource, ^{
        ActiveWindowObserver *strongObserver = observerRef;
        if (strongObserver) [strongObserver periodicBackupCheck];
    });
    dispatch_resume(periodicCheckSource);
    MyLog(@"📅 Native window watchdog started (1 second foreground PID checks)");
}

- (void)stopPeriodicBackupTimer {
    if (periodicCheckSource) {
        dispatch_source_cancel(periodicCheckSource);
        periodicCheckSource = nil;
    }
    MyLog(@"📅 Periodic backup timer stopped");
}

// Backup check only repairs missed app/window notifications. It intentionally
// avoids OCR, content extraction, and model work until a new identity is seen.
- (void)periodicBackupCheck {
    if (activityCapturePaused) return;
    NSRunningApplication *frontmostApplication = [[NSWorkspace sharedWorkspace] frontmostApplication];
    if (!frontmostApplication) return;
    NSString *bundleIdentifier = frontmostApplication.bundleIdentifier ?: @"";
    // Leaving Firefox must reset its tab tracker even if macOS never yielded
    // a usable intermediate window record. Otherwise returning to the same
    // tab is incorrectly treated as an unchanged foreground activity.
    if (![bundleIdentifier isEqualToString:@"org.mozilla.firefox"] && firefoxTabTracking.isFirefoxActive) {
        [firefoxTabTracking stopFirefoxTabTimer];
    }
    pid_t frontmostPid = frontmostApplication.processIdentifier;
    BOOL foregroundApplicationChanged = frontmostPid != lastWatchdogForegroundPid;
    lastWatchdogForegroundPid = frontmostPid;
    // A PID comparison stays at one second because it repairs missed app
    // activation notifications. AX is the normal same-app window signal; a
    // healthy observer needs only an occasional 30-second CG sanity check.
    // If AX is unavailable, retain the original five-second fallback.
    watchdogTickCount++;
    BOOL hasHealthyAccessibilityObserver = observer != Nil && processId != nil && [processId intValue] == frontmostPid;
    NSUInteger signatureInterval = hasHealthyAccessibilityObserver ? 30 : 5;
    if (!foregroundApplicationChanged && watchdogTickCount % signatureInterval != 0) return;
    NSDictionary *identity = [self getActiveWindowIdentity];
    if (!identity) return;
    NSString *signature = [self signatureForWindowInfo:identity];
    if (lastObservedWindowSignature && [lastObservedWindowSignature isEqualToString:signature]) return;

    [self scheduleCaptureForCurrentFrontmostWindowWithReason:@"periodic_backup"];
}

- (NSString *)signatureForWindowInfo:(NSDictionary *)windowInfo {
    return [NSString stringWithFormat:@"%@|%@|%@",
        windowInfo[@"id"] ?: @"",
        windowInfo[@"ownerName"] ?: @"",
        windowInfo[@"title"] ?: @""];
}

- (NSDictionary *)frontmostEligibleWindowRecord {
    NSRunningApplication *frontmostApplication = [[NSWorkspace sharedWorkspace] frontmostApplication];
    if (!frontmostApplication) return nil;
    pid_t frontmostPid = frontmostApplication.processIdentifier;
    NSString *bundleIdentifier = frontmostApplication.bundleIdentifier ?: @"";
    NSString *applicationName = frontmostApplication.localizedName ?: @"Unknown";

    // Do not let Tempo or its native notch helper become the tracked app when
    // one of their panels temporarily receives interaction.
    if ([bundleIdentifier hasPrefix:@"com.tempo.local"] ||
        [applicationName isEqualToString:@"Tempo"] ||
        [applicationName isEqualToString:@"Tempo Notch Helper"]) return nil;

    CFArrayRef windowList = CGWindowListCopyWindowInfo(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
        kCGNullWindowID
    );
    if (!windowList) return nil;
    NSArray *windows = (NSArray *)windowList;
    NSDictionary *fallback = nil;
    for (NSDictionary *window in windows) {
        if ([window[(id)kCGWindowLayer] intValue] != 0) continue;
        if ([window[(id)kCGWindowOwnerPID] intValue] != frontmostPid) continue;
        NSString *ownerName = window[(id)kCGWindowOwnerName] ?: @"Unknown";
        NSString *title = window[(id)kCGWindowName] ?: @"";
        if ([ownerName isEqualToString:@"WindowManager"] && [title isEqualToString:@"Tiling Handle Window"]) continue;
        if (shouldExcludeApp(ownerName, title)) continue;
        NSNumber *windowId = window[(id)kCGWindowNumber];
        if (!windowId) continue;
        NSDictionary *record = @{
            @"id": windowId,
            @"ownerName": ownerName,
            @"title": title,
            @"pid": @(frontmostPid),
            @"bundleIdentifier": bundleIdentifier,
        };
        // CGWindowList is ordered front-to-back for a process, so the first
        // eligible record is its current main/focused-window fallback.
        if (!fallback) fallback = record;
    }
    CFRelease(windowList);
    return fallback;
}

- (NSDictionary *)getActiveWindowIdentity {
    return [self frontmostEligibleWindowRecord];
}

- (void)scheduleCaptureForCurrentFrontmostWindowWithReason:(NSString *)reason {
    [self scheduleCaptureForCurrentFrontmostWindowWithReason:reason retryAttempt:0];
}

- (void)scheduleCaptureForCurrentFrontmostWindowWithReason:(NSString *)reason retryAttempt:(NSUInteger)retryAttempt {
    if (activityCapturePaused) return;
    NSDictionary *identity = [self getActiveWindowIdentity];
    if (!identity) {
        // macOS can expose no layer-0 window briefly during an app switch or
        // Space transition. Retry the identity read a few times before the
        // next watchdog tick instead of silently retaining the old activity.
        if (retryAttempt < 4) {
            ActiveWindowObserver *observerRef = self;
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 200 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
                ActiveWindowObserver *strongObserver = observerRef;
                if (strongObserver) [strongObserver scheduleCaptureForCurrentFrontmostWindowWithReason:reason retryAttempt:retryAttempt + 1];
            });
        }
        return;
    }
    NSString *expectedSignature = [self signatureForWindowInfo:identity];
    NSUInteger generation = ++captureGeneration;
    ActiveWindowObserver *observerRef = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.75 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        ActiveWindowObserver *strongObserver = observerRef;
        if (!strongObserver || strongObserver->activityCapturePaused || generation != strongObserver->captureGeneration) return;
        NSDictionary *currentIdentity = [strongObserver getActiveWindowIdentity];
        if (!currentIdentity || ![[strongObserver signatureForWindowInfo:currentIdentity] isEqualToString:expectedSignature]) {
            if (retryAttempt < 4)
                [strongObserver scheduleCaptureForCurrentFrontmostWindowWithReason:reason retryAttempt:retryAttempt + 1];
            return;
        }
        NSDictionary *windowInfo = [strongObserver getActiveWindow];
        if (windowInfo) [strongObserver handleObservedWindowInfo:windowInfo withReason:reason];
    });
}

- (void) receiveAppChangeNotification:(NSNotification *) notification {
    [self removeWindowObserver];

    int currentAppPid = [NSProcessInfo processInfo].processIdentifier;
    NSDictionary<NSString*, NSRunningApplication*> *userInfo = [notification userInfo];
    NSNumber *selectedProcessId = [userInfo valueForKeyPath:@"NSWorkspaceApplicationKey.processIdentifier"];
    NSRunningApplication *selectedApplication = [userInfo valueForKeyPath:@"NSWorkspaceApplicationKey"];
    NSString *selectedBundleIdentifier = selectedApplication.bundleIdentifier ?: @"";

    // Reset browser-specific state on activation, before waiting for a stable
    // CGWindow record. This makes a return to the same Firefox tab a real
    // foreground capture even when the intermediate app had no eligible window.
    if (![selectedBundleIdentifier isEqualToString:@"org.mozilla.firefox"]) {
        [firefoxTabTracking stopFirefoxTabTimer];
    }
    if (![selectedBundleIdentifier isEqualToString:@"com.google.Chrome"]) {
        [chromeTabTracking stopChromeTabTimer];
        chromeTabTracking.isChromeActive = NO;
    }

    if (processId != nil && selectedProcessId.intValue == currentAppPid) {
        return;
    }

    processId = selectedProcessId;
    
    // 🎯 NEW: Track app switch timing
    lastAppSwitchTime = [[NSDate date] timeIntervalSince1970];

    // Capture the PID for this specific operation before the async block.
    NSNumber *currentOperationProcessId = self->processId; 


    // Let macOS settle, then apply the shared 750 ms stability policy before
    // doing browser queries, OCR, or application-content extraction.
    dispatch_time_t popTime = dispatch_time(DISPATCH_TIME_NOW, (int64_t)(100 * NSEC_PER_MSEC));
    dispatch_after(popTime, dispatch_get_main_queue(), ^(void){
        if (windowObserver != self || activityCapturePaused || processId != currentOperationProcessId) return;
        [self scheduleCaptureForCurrentFrontmostWindowWithReason:@"app_switch"];

        // Setup observer for the new application
        AXUIElementRef appElem = AXUIElementCreateApplication(currentOperationProcessId.intValue);
        if (!appElem) {
            // MyLog(@"[AppSwitch]   Failed to create AXUIElement for PID %@", currentOperationProcessId);
            return;
        }
        
        // self->observer should be Nil here due to [self removeWindowObserver] at the start of receiveAppChangeNotification
        AXError createResult = AXObserverCreate(currentOperationProcessId.intValue, windowChangeCallback, &(self->observer));

        if (createResult != kAXErrorSuccess) {
            // MyLog(@"[AppSwitch]   AXObserverCreate failed for PID %@: Error %d", currentOperationProcessId, createResult);
            CFRelease(appElem); // Release appElem if observer creation fails
            return;
        }

        AXObserverAddNotification(self->observer, appElem, kAXMainWindowChangedNotification, (__bridge void *)(self));
        AXObserverAddNotification(self->observer, appElem, kAXFocusedWindowChangedNotification, (__bridge void *)(self));
        CFRunLoopAddSource([[NSRunLoop currentRunLoop] getCFRunLoop], AXObserverGetRunLoopSource(self->observer), kCFRunLoopDefaultMode);
        
        CFRelease(appElem); // Release the element as its information has been registered
    });
}

- (void)handleObservedWindowInfo:(NSDictionary *)windowInfo {
    [self handleObservedWindowInfo:windowInfo withReason:@"app_switch"];
}

- (void)handleObservedWindowInfo:(NSDictionary *)windowInfo withReason:(NSString *)reason {
    if (activityCapturePaused) return;
    if ([windowInfo[@"ownerName"] isEqualToString:@"Firefox"]) {
        [firefoxTabTracking beginTrackingWithInitialWindowInfo:windowInfo];
        return;
    }
    [firefoxTabTracking stopFirefoxTabTimer];
    [self sendWindowInfoToJS:windowInfo withReason:reason];
}

// Serialize a capture without persisting its evidence or borrowing buffer storage.
- (void)sendWindowInfoToJS:(NSDictionary*)windowInfo withReason:(NSString*)reason {
    if (!activeWindowChangedCallback) return;
    if (activityCapturePaused && ![windowInfo[@"type"] isEqualToString:@"system"]) return;
    NSMutableDictionary *payload = [NSMutableDictionary dictionaryWithDictionary:windowInfo];
    payload[@"captureReason"] = reason;
    payload[@"timestamp"] = @([[NSDate date] timeIntervalSince1970] * 1000);
    NSData *encoded = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
    if (!encoded) return;
    std::string *message = new std::string((const char *)encoded.bytes, encoded.length);
    if (activeWindowChangedCallback.NonBlockingCall(message, napiCallback) != napi_ok) {
        delete message;
        return;
    }
    NSString *delivered = [[self signatureForWindowInfo:payload] copy];
    [lastObservedWindowSignature release];
    lastObservedWindowSignature = delivered;
}

- (NSDictionary*)getActiveWindow {
    NSDictionary *frontmostWindow = [self frontmostEligibleWindowRecord];

    if (frontmostWindow) {
        NSNumber *windowNumber = frontmostWindow[@"id"];
        NSString *windowOwnerName = frontmostWindow[@"ownerName"];
        NSString *windowTitle = frontmostWindow[@"title"];

        NSString *iconPath = getAppIconPath(windowOwnerName);
        
        // Create base window info
        NSMutableDictionary *windowInfo = [@{
            @"id": windowNumber,
            @"ownerName": windowOwnerName ? windowOwnerName : @"Unknown",
            @"title": windowTitle ? windowTitle : @"",
            @"type": @"window",
            @"icon": iconPath ? iconPath : @"",
            @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
        } mutableCopy];

        // If we don't have a window title, try to get it using our title extractor
        if (!windowTitle || windowTitle.length == 0) {
            NSString *extractedTitle = [TitleExtractor extractWindowTitleForApp:windowOwnerName];
            if (extractedTitle && extractedTitle.length > 0) {
                windowInfo[@"title"] = extractedTitle;
                MyLog(@"Title extraction succeeded");
            } else {
                MyLog(@"   ⚠️  Could not extract title for app: %@", windowOwnerName);
            }
        }

        MyLog(@"Active window changed");
        
        const BOOL chromeSelected = [windowOwnerName isEqualToString:@"Google Chrome"];
        if (chromeSelected && !chromeTabTracking.isChromeActive) {
            chromeTabTracking.isChromeActive = YES;
            [chromeTabTracking startChromeTabTimer];
        }
        if (!chromeSelected && chromeTabTracking.isChromeActive) {
            chromeTabTracking.isChromeActive = NO;
            [chromeTabTracking stopChromeTabTimer];
            chromeTabTracking.lastKnownChromeURL = nil;
            chromeTabTracking.lastKnownChromeTitle = nil;
        }
        NSDictionary *browserEvidence = chromeSelected ? [BrowserTabUtils getChromeTabInfo] :
            ([windowOwnerName isEqualToString:@"Safari"] ? [BrowserTabUtils getSafariTabInfo] : nil);
        if (browserEvidence) {
            [windowInfo addEntriesFromDictionary:browserEvidence];
            if (chromeSelected && !chromeTabTracking.lastKnownChromeURL && browserEvidence[@"url"]) {
                chromeTabTracking.lastKnownChromeURL = browserEvidence[@"url"];
                chromeTabTracking.lastKnownChromeTitle = browserEvidence[@"title"];
            }
        }
        // Firefox is enriched asynchronously. Other apps remain title-only.
        return windowInfo;
    }
    return nil;
}

- (void) removeWindowObserver
{
    if (observer != Nil) {
        CFRunLoopRemoveSource([[NSRunLoop currentRunLoop] getCFRunLoop], AXObserverGetRunLoopSource(observer), kCFRunLoopDefaultMode);
        CFRelease(observer);
        observer = Nil;
    }
}

- (void)cleanUp {
    activityCapturePaused = YES;
    captureGeneration++;
    chromeTabTracking.delegate = nil;
    firefoxTabTracking.delegate = nil;
    [self stopPeriodicBackupTimer];    
    [chromeTabTracking stopChromeTabTimer];
    [firefoxTabTracking stopFirefoxTabTimer];
    [sleepAndLockObserver stopObserving];
    [[[NSWorkspace sharedWorkspace] notificationCenter] removeObserver:self];
    [self removeWindowObserver];
}

// App exclusion related - REMOVED, see appFilter.mm

- (void)chromeTabDidSwitch:(NSDictionary *)newTabInfo {
    MyLog(@"Chrome tab switch captured");
    [self sendWindowInfoToJS:newTabInfo withReason:@"chrome_tab_switch"];
}

- (void)firefoxTabDidCapture:(NSDictionary *)newTabInfo reason:(NSString *)reason {
    if (activityCapturePaused) return;
    [self sendWindowInfoToJS:newTabInfo withReason:reason];
}

- (void)setActivityCapturePaused:(BOOL)paused {
    manualOrFocusPaused = paused;
    [self updateActivityCaptureSuspension];
}

- (void)setSystemSuspension:(NSString *)kind {
    if ([kind isEqualToString:@"lock"]) screenLocked = YES;
    else if ([kind isEqualToString:@"unlock"]) screenLocked = NO;
    else if ([kind isEqualToString:@"sleep"]) systemSleeping = YES;
    else if ([kind isEqualToString:@"wake"]) systemSleeping = NO;
    [self updateActivityCaptureSuspension];
}

- (void)updateActivityCaptureSuspension {
    BOOL shouldPause = manualOrFocusPaused || screenLocked || systemSleeping;
    if (activityCapturePaused == shouldPause) return;
    activityCapturePaused = shouldPause;
    captureGeneration++;
    if (shouldPause) {
        [self stopPeriodicBackupTimer];
        [chromeTabTracking stopChromeTabTimer];
        [firefoxTabTracking stopFirefoxTabTimer];
        return;
    }

    // Do not reuse an activity observed before a lock/sleep boundary. The
    // shared stability gate produces one fresh post-resume capture.
    [self startPeriodicBackupTimer];
    [self scheduleCaptureForCurrentFrontmostWindowWithReason:@"app_switch"];
}

// This is intentionally a user-triggered recovery action. It makes the
// currently frontmost app flow through the ordinary capture path even if a
// macOS activation notification was lost. It does not bypass pause/lock state
// and never talks to the classifier directly.
- (BOOL)refreshActiveWindow {
    if (activityCapturePaused) return NO;
    NSDictionary *identity = [self getActiveWindowIdentity];
    if (!identity) return NO;

    NSString *ownerName = identity[@"ownerName"] ?: @"";
    if ([ownerName isEqualToString:@"Firefox"]) {
        // Restarting this lightweight tracker deliberately schedules a fresh
        // capture for the visible Firefox tab, even when its title did not
        // change. This is only used by the explicit recovery button.
        [firefoxTabTracking stopFirefoxTabTimer];
    }
    [self scheduleCaptureForCurrentFrontmostWindowWithReason:@"app_switch"];
    return YES;
}

// A wake notification can occasionally be missed by macOS. This is an
// explicit recovery path from Tempo's UI, so clear only the two system-owned
// gates. `manualOrFocusPaused` remains intact and still prevents capture when
// the user deliberately paused Tempo or is on a scheduled break.
- (BOOL)resumeAfterSystemSuspension {
    BOOL wasCapturePaused = activityCapturePaused;
    screenLocked = NO;
    systemSleeping = NO;
    [self updateActivityCaptureSuspension];

    // When native capture was already running, `updateActivityCaptureSuspension`
    // has no transition to schedule. Still force the normal 750 ms stable
    // capture so this recovery always rechecks the frontmost activity.
    if (!activityCapturePaused && !wasCapturePaused) {
        [self scheduleCaptureForCurrentFrontmostWindowWithReason:@"app_switch"];
    }
    return !activityCapturePaused;
}

- (void)setFirefoxNavigationState:(NSDictionary *)navigationState {
    [firefoxTabTracking setNavigationState:navigationState];
}

- (void)setFirefoxCompanionConnected:(BOOL)connected {
    [firefoxTabTracking setCompanionConnected:connected];
}

- (void)captureFirefoxNavigation:(NSNumber *)windowId title:(NSString *)title fingerprint:(NSString *)fingerprint {
    if (activityCapturePaused) return;
    [firefoxTabTracking captureNavigationForWindowId:windowId title:title fingerprint:fingerprint];
}

@end

void initActiveWindowObserver(Napi::Env env, Napi::Function windowCallback) {
    if (windowObserver) stopActiveWindowObserver(env);
    activeWindowChangedCallback = Napi::ThreadSafeFunction::New(env, windowCallback, "ActiveWindowChanged", 16, 1);
    windowObserver = [[ActiveWindowObserver alloc] init];
}

void stopActiveWindowObserver(Napi::Env env) {
    if (windowObserver) {
        [windowObserver cleanUp];
        [windowObserver release];
        windowObserver = nil;
    }
    if (activeWindowChangedCallback) {
        activeWindowChangedCallback.Abort();
        activeWindowChangedCallback = nullptr;
    }
}

void setActivityCapturePaused(BOOL paused) {
    if (windowObserver) [windowObserver setActivityCapturePaused:paused];
}

BOOL refreshActiveWindow(void) {
    return windowObserver ? [windowObserver refreshActiveWindow] : NO;
}

BOOL resumeAfterSystemSuspension(void) {
    return windowObserver ? [windowObserver resumeAfterSystemSuspension] : NO;
}

void setFirefoxNavigationState(NSDictionary *navigationState) {
    if (windowObserver) [windowObserver setFirefoxNavigationState:navigationState];
}

void setFirefoxCompanionConnected(BOOL connected) {
    if (windowObserver) [windowObserver setFirefoxCompanionConnected:connected];
}

void captureFirefoxNavigation(NSNumber *windowId, NSString *title, NSString *fingerprint) {
    if (windowObserver) [windowObserver captureFirefoxNavigation:windowId title:title fingerprint:fingerprint];
}
