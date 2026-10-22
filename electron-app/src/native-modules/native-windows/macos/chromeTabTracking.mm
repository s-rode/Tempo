// Adapted from MIT Cronus browserTabTracking at 222adf835a3a210ca5375a3876e7ed1fed31bb9e.
#import "chromeTabTracking.h"
#import "browserTabUtils.h"
#import "permissionManager.h"

// Custom Log Macro
#define MyLog(...) do {} while (0)

@implementation ChromeTabTracking

- (id)init {
    self = [super init];
    if (self) {
        _lastKnownChromeURL = nil;
        _lastKnownChromeTitle = nil;
        _isChromeActive = NO;
        _chromeTabCheckTimer = nil;
        _browserName = [@"Google Chrome" copy];
    }
    return self;
}

- (void)dealloc {
    [self stopChromeTabTimer];
    [_lastKnownChromeURL release];
    [_lastKnownChromeTitle release];
    [_browserName release];
    [super dealloc];
}

- (NSDictionary*)getCurrentChromeTabBriefInfo {
    if (!self.browserName) {
        MyLog(@"[Browser Tab Brief] ⚠️ Browser name not set, cannot get tab info.");
        return nil;
    }

    if (![PermissionManager shouldRequestPermissions]) {
        MyLog(@"[Browser Tab Brief] ⚠️  Permission requests disabled - skipping tab tracking during onboarding");
        return nil;
    }
    
    // Do not send Apple Events to a browser that has exited: that can relaunch it.
    if ([[NSRunningApplication runningApplicationsWithBundleIdentifier:@"com.google.Chrome"] count] == 0) {
        self.isChromeActive = NO;
        [self stopChromeTabTimer];
        self.lastKnownChromeURL = nil;
        self.lastKnownChromeTitle = nil;
        return nil;
    }

    NSString *scriptSource = [NSString stringWithFormat:@"tell application \"%@\"\n"
                           "  try\n"
                           "    set tabTitle to title of active tab of front window\n"
                           "    set tabUrl to URL of active tab of front window\n"
                           "    return tabUrl & \"|\" & tabTitle\n"
                           "  on error errMsg\n"
                           "    return \"ERROR|\" & errMsg\n"
                           "  end try\n"
                           "end tell", self.browserName];
    NSAppleScript *appleScript = [[NSAppleScript alloc] initWithSource:scriptSource];
    NSDictionary *errorInfo = nil;
    NSAppleEventDescriptor *descriptor = [appleScript executeAndReturnError:&errorInfo];
    [appleScript release];

    if (errorInfo) {
        MyLog(@"[Browser Tab Brief] AppleScript execution error for %@: %@", self.browserName, errorInfo);
        
        // If this is the first time accessing Chrome and permissions aren't granted,
        // request Apple Events permission through our centralized system
        if ([PermissionManager shouldRequestPermissions]) {
            MyLog(@"[Browser Tab Brief] 🔑 Requesting Apple Events permission for %@ tab tracking", self.browserName);
            [PermissionManager requestPermission:PermissionTypeAppleEvents completion:^(PermissionStatus status) {
                MyLog(@"[Browser Tab Brief] 📋 Apple Events permission request completed with status: %ld", (long)status);
            }];
        }
        
        return nil;
    }

    NSString *resultString = [descriptor stringValue];
    if (!resultString || [resultString hasPrefix:@"ERROR|"]) {
        if (resultString && ![resultString isEqualToString:@"ERROR|No window"]) {
             MyLog(@"[Browser Tab Brief] AppleScript reported error for %@: %@", self.browserName, resultString);
        }
        return nil;
    }
    
    NSArray *components = [resultString componentsSeparatedByString:@"|"];
    if (components.count >= 1) {
        NSString *url = components[0];
        NSString *title = (components.count > 1) ? components[1] : @"";
        return @{@"url": url, @"title": title};
    }
    
    MyLog(@"[Browser Tab Brief] Invalid components from AppleScript for %@: %@", self.browserName, resultString);
    return nil;
}

- (void)startChromeTabTimer {
    if (_chromeTabCheckTimer) {
        [_chromeTabCheckTimer invalidate];
        [_chromeTabCheckTimer release];
        _chromeTabCheckTimer = nil;
    }
    _chromeTabCheckTimer = [[NSTimer scheduledTimerWithTimeInterval:1.5
                                                                target:self
                                                              selector:@selector(performChromeTabCheck)
                                                              userInfo:nil
                                                               repeats:YES] retain];
    [[NSRunLoop currentRunLoop] addTimer:_chromeTabCheckTimer forMode:NSRunLoopCommonModes];
    MyLog(@"[Browser Tab] ▶️ %@ tab check timer started.", self.browserName);
}

- (void)stopChromeTabTimer {
    if (_chromeTabCheckTimer) {
        [_chromeTabCheckTimer invalidate];
        [_chromeTabCheckTimer release];
        _chromeTabCheckTimer = nil;
        MyLog(@"[Browser Tab] ⏹️ %@ tab check timer stopped.", self.browserName);
    }
}

- (void)performChromeTabCheck {
    if (!_isChromeActive) {
        return;
    }

    NSDictionary *briefTabInfo = [self getCurrentChromeTabBriefInfo];
    if (briefTabInfo) {
        NSString *currentURL = briefTabInfo[@"url"];
        NSString *currentTitle = briefTabInfo[@"title"];

        BOOL urlChanged = (_lastKnownChromeURL || currentURL) && ![_lastKnownChromeURL isEqualToString:currentURL];
        BOOL titleChanged = (_lastKnownChromeTitle || currentTitle) && ![_lastKnownChromeTitle isEqualToString:currentTitle];

        if (urlChanged || titleChanged) {
            MyLog(@"[Browser Tab] 🔄 %@ Tab Switch Detected:", self.browserName);
            if (urlChanged) MyLog(@"   URL: '%@' -> '%@'", _lastKnownChromeURL, currentURL);
            if (titleChanged) MyLog(@"   Title: '%@' -> '%@'", _lastKnownChromeTitle, currentTitle);

            NSString *newURL = [currentURL copy];
            [_lastKnownChromeURL release];
            _lastKnownChromeURL = newURL;

            NSString *newTitle = [currentTitle copy];
            [_lastKnownChromeTitle release];
            _lastKnownChromeTitle = newTitle;
            
            NSDictionary *activeWindowDetails = [BrowserTabUtils getChromeTabInfo];

            if (activeWindowDetails) {
                 if (self.delegate && [self.delegate respondsToSelector:@selector(chromeTabDidSwitch:)]) {
                    [self.delegate chromeTabDidSwitch:activeWindowDetails];
                }
            } else {
                MyLog(@"   Could not get active window details after tab switch for %@", self.browserName);
            }
        }
    }
}

@end 