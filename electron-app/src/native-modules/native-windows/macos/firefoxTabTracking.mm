#import "firefoxTabTracking.h"

#import "windowOcrCapture.h"

static NSString * const kFirefoxBundleIdentifier = @"org.mozilla.firefox";

@interface FirefoxTabTracking ()
@property (nonatomic, retain) NSTimer *tabCheckTimer;
@property (nonatomic, retain) NSDictionary *lastKnownWindowInfo;
@property (nonatomic, retain) NSDictionary *pendingWindowInfo;
@property (nonatomic, retain) NSString *pendingReason;
@property (nonatomic, retain) NSDictionary *capturingWindowInfo;
@property (nonatomic, assign) BOOL isCaptureInFlight;
@property (nonatomic, assign) NSUInteger captureGeneration;
@property (nonatomic, retain) NSMutableDictionary *navigationByWindowId;
@property (nonatomic, retain) NSMutableDictionary *navigationByTitle;
@property (nonatomic, assign) BOOL companionConnected;
@end

@implementation FirefoxTabTracking

- (void)dealloc {
    [self stopFirefoxTabTimer];
    [_lastKnownWindowInfo release];
    [_pendingWindowInfo release];
    [_pendingReason release];
    [_capturingWindowInfo release];
    [_navigationByWindowId release];
    [_navigationByTitle release];
    [super dealloc];
}

- (NSMutableDictionary *)navigationByWindowId {
    if (!_navigationByWindowId) _navigationByWindowId = [[NSMutableDictionary alloc] init];
    return _navigationByWindowId;
}

- (NSMutableDictionary *)navigationByTitle {
    if (!_navigationByTitle) _navigationByTitle = [[NSMutableDictionary alloc] init];
    return _navigationByTitle;
}

// Firefox's WebExtension windowId is not the CGWindowID exposed by macOS.
// Bind extension metadata to the frontmost matching native window, and retain
// a title fallback for messages that arrive while Firefox is backgrounded.
- (NSDictionary *)navigationForWindowInfo:(NSDictionary *)windowInfo {
    NSString *nativeWindowKey = [windowInfo[@"id"] stringValue];
    NSString *title = windowInfo[@"title"] ?: @"";
    NSDictionary *navigation = self.navigationByWindowId[nativeWindowKey];
    // A macOS window keeps its CGWindowID while Firefox changes tabs. Do not
    // reuse navigation metadata merely because it was previously bound to the
    // same native window: during a tab switch it can describe the old page.
    // Returning it would make the server's exact-document cache apply that
    // page's category to the newly visible title.
    if (navigation && [navigation[@"title"] isEqualToString:title]) return navigation;
    if (navigation) [self.navigationByWindowId removeObjectForKey:nativeWindowKey];
    navigation = self.navigationByTitle[title];
    if (navigation) self.navigationByWindowId[nativeWindowKey] = navigation;
    return navigation;
}

- (NSDictionary *)frontmostFirefoxWindowInfo {
    NSRunningApplication *frontmostApp = [NSWorkspace sharedWorkspace].frontmostApplication;
    if (![frontmostApp.bundleIdentifier isEqualToString:kFirefoxBundleIdentifier]) return nil;

    pid_t pid = frontmostApp.processIdentifier;
    CFArrayRef windowList = CGWindowListCopyWindowInfo(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
        kCGNullWindowID
    );
    if (!windowList) return nil;
    NSDictionary *result = nil;
    for (NSDictionary *window in (NSArray *)windowList) {
        if ([window[(id)kCGWindowLayer] integerValue] != 0) continue;
        if ([window[(id)kCGWindowOwnerPID] intValue] != pid) continue;
        NSNumber *windowId = window[(id)kCGWindowNumber];
        if (!windowId) continue;
        result = @{
            @"id": windowId,
            @"ownerName": @"Firefox",
            @"title": window[(id)kCGWindowName] ?: @"",
            @"type": @"browser",
            @"browser": @"firefox",
        };
        break;
    }
    CFRelease(windowList);
    return result;
}

- (BOOL)matchesCurrentFirefoxWindow:(NSDictionary *)windowInfo {
    NSDictionary *current = [self frontmostFirefoxWindowInfo];
    return current &&
      [current[@"id"] isEqual:windowInfo[@"id"]] &&
      [current[@"title"] isEqualToString:windowInfo[@"title"]];
}

- (void)startFirefoxTabTimer {
    // The companion delivers stable navigation/tab changes event-driven. The
    // CGWindowList timer is retained only as the privacy-preserving fallback
    // when that local companion is disconnected.
    if (_companionConnected) return;
    if (_tabCheckTimer) return;
    _tabCheckTimer = [[NSTimer scheduledTimerWithTimeInterval:1.5
                                                        target:self
                                                      selector:@selector(performFirefoxTabCheck)
                                                      userInfo:nil
                                                       repeats:YES] retain];
    [[NSRunLoop currentRunLoop] addTimer:_tabCheckTimer forMode:NSRunLoopCommonModes];
}

- (void)stopFirefoxTabTimer {
    _isFirefoxActive = NO;
    _captureGeneration++;
    [_tabCheckTimer invalidate];
    [_tabCheckTimer release];
    _tabCheckTimer = nil;
    [_lastKnownWindowInfo release];
    _lastKnownWindowInfo = nil;
    [_pendingWindowInfo release];
    _pendingWindowInfo = nil;
    [_pendingReason release];
    _pendingReason = nil;
}

- (void)beginTrackingWithInitialWindowInfo:(NSDictionary *)windowInfo {
    // The active-window observer gives us a generic "window" record on application
    // activation. Re-read it here so every Firefox capture starts from the canonical
    // browser-shaped record (browser: firefox, type: browser), rather than allowing
    // a generic Firefox application event to override a page-specific OCR result.
    NSDictionary *currentFirefoxWindow = [self frontmostFirefoxWindowInfo];
    if (!currentFirefoxWindow) return;
    windowInfo = currentFirefoxWindow;
    if (_isFirefoxActive) {
        BOOL changed = ![_lastKnownWindowInfo[@"id"] isEqual:windowInfo[@"id"]] ||
          ![_lastKnownWindowInfo[@"title"] isEqualToString:windowInfo[@"title"]];
        if (!changed) return;
        [_lastKnownWindowInfo release];
        _lastKnownWindowInfo = [windowInfo copy];
        [self scheduleCaptureForWindowInfo:windowInfo reason:@"firefox_tab_switch"];
        return;
    }
    _isFirefoxActive = YES;
    [_lastKnownWindowInfo release];
    _lastKnownWindowInfo = [windowInfo copy];
    [self startFirefoxTabTimer];
    [self scheduleCaptureForWindowInfo:windowInfo reason:@"firefox_activation"];
}

- (void)setCompanionConnected:(BOOL)connected {
    if (_companionConnected == connected) return;
    _companionConnected = connected;
    if (connected) {
        [self stopFirefoxTabTimer];
        // `stopFirefoxTabTimer` resets the active flag as well, but Firefox is
        // still foreground. Keep the logical state so the next navigation can
        // immediately schedule its ordinary capture.
        _isFirefoxActive = YES;
        return;
    }
    if (_isFirefoxActive) {
        [self startFirefoxTabTimer];
        [self performFirefoxTabCheck];
    }
}

- (void)performFirefoxTabCheck {
    if (!_isFirefoxActive) return;
    NSDictionary *current = [self frontmostFirefoxWindowInfo];
    if (!current) {
        [self stopFirefoxTabTimer];
        return;
    }
    BOOL changed = ![_lastKnownWindowInfo[@"id"] isEqual:current[@"id"]] ||
      ![_lastKnownWindowInfo[@"title"] isEqualToString:current[@"title"]];
    if (!changed) return;

    [_lastKnownWindowInfo release];
    _lastKnownWindowInfo = [current copy];
    [self scheduleCaptureForWindowInfo:current reason:@"firefox_tab_switch"];
}

- (void)scheduleCaptureForWindowInfo:(NSDictionary *)windowInfo reason:(NSString *)reason {
    NSDictionary *navigation = [self navigationForWindowInfo:windowInfo];
    NSString *fingerprint = navigation[@"fingerprint"];
    NSString *windowTitle = windowInfo[@"title"] ?: @"";
    if (fingerprint && [navigation[@"title"] isEqualToString:windowTitle]) {
        NSUInteger generation = ++_captureGeneration;
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            if (!self.isFirefoxActive || generation != self.captureGeneration || ![self matchesCurrentFirefoxWindow:windowInfo]) return;
            NSMutableDictionary *event = [windowInfo mutableCopy];
            event[@"navigationFingerprint"] = fingerprint;
            if (navigation[@"pageCorrectionKey"]) event[@"pageCorrectionKey"] = navigation[@"pageCorrectionKey"];
            event[@"contentCaptureStatus"] = @"navigation_pending";
            if (self.delegate && [self.delegate respondsToSelector:@selector(firefoxTabDidCapture:reason:)]) {
                [self.delegate firefoxTabDidCapture:event reason:reason];
            }
            [event release];
        });
        return;
    }
    [_pendingWindowInfo release];
    _pendingWindowInfo = [windowInfo copy];
    [_pendingReason release];
    _pendingReason = [reason copy];
    NSUInteger generation = ++_captureGeneration;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        if (!self.isFirefoxActive || generation != self.captureGeneration) return;
        [self startPendingCaptureIfPossible];
    });
}

- (void)setNavigationState:(NSDictionary *)navigationState {
    id rawTitle = navigationState[@"title"];
    id rawFingerprint = navigationState[@"navigationFingerprint"];
    id rawPageCorrectionKey = navigationState[@"pageCorrectionKey"];
    if (![rawTitle isKindOfClass:[NSString class]] ||
        ![rawFingerprint isKindOfClass:[NSString class]] ||
        ![rawPageCorrectionKey isKindOfClass:[NSString class]]) return;
    NSString *title = (NSString *)rawTitle;
    NSString *fingerprint = (NSString *)rawFingerprint;
    NSString *pageCorrectionKey = (NSString *)rawPageCorrectionKey;
    if (title.length == 0 || fingerprint.length == 0 || pageCorrectionKey.length == 0) return;
    NSMutableDictionary *navigation = [@{
        @"title": title,
        @"fingerprint": fingerprint,
        @"pageCorrectionKey": pageCorrectionKey,
    } mutableCopy];
    self.navigationByTitle[title] = navigation;
    NSDictionary *current = [self frontmostFirefoxWindowInfo];
    if (self.isFirefoxActive && current && [current[@"title"] isEqualToString:title]) {
        self.navigationByWindowId[[current[@"id"] stringValue]] = navigation;
        [self scheduleCaptureForWindowInfo:current reason:@"firefox_activation"];
    }
    [navigation release];
}

- (void)captureNavigationForWindowId:(NSNumber *)windowId title:(NSString *)title fingerprint:(NSString *)fingerprint {
    NSDictionary *current = [self frontmostFirefoxWindowInfo];
    if (!self.isFirefoxActive || !current || ![current[@"id"] isEqual:windowId] || ![current[@"title"] isEqualToString:title]) return;
    NSDictionary *navigation = self.navigationByWindowId[[windowId stringValue]];
    if (!navigation || ![navigation[@"fingerprint"] isEqualToString:fingerprint]) return;
    [_pendingWindowInfo release];
    _pendingWindowInfo = [current copy];
    [_pendingReason release];
    _pendingReason = [@"firefox_tab_switch" copy];
    NSUInteger generation = ++_captureGeneration;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.05 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        if (!self.isFirefoxActive || generation != self.captureGeneration) return;
        [self startPendingCaptureIfPossible];
    });
}

- (void)startPendingCaptureIfPossible {
    if (_isCaptureInFlight || !_pendingWindowInfo) return;
    NSDictionary *windowInfo = [_pendingWindowInfo retain];
    NSString *reason = [_pendingReason retain];
    [_pendingWindowInfo release];
    _pendingWindowInfo = nil;
    [_pendingReason release];
    _pendingReason = nil;

    if (![self matchesCurrentFirefoxWindow:windowInfo]) {
        [windowInfo release];
        [reason release];
        return;
    }
    _isCaptureInFlight = YES;
    [_capturingWindowInfo release];
    _capturingWindowInfo = [windowInfo copy];
    [WindowOcrCapture captureTextForWindowId:[windowInfo[@"id"] unsignedIntValue]
                             bundleIdentifier:kFirefoxBundleIdentifier
                                   completion:^(NSString *text, NSString *status) {
        self.isCaptureInFlight = NO;
        BOOL isStillCurrent = [self matchesCurrentFirefoxWindow:windowInfo];
        if (self.isFirefoxActive && isStillCurrent && self.delegate &&
            [self.delegate respondsToSelector:@selector(firefoxTabDidCapture:reason:)]) {
            NSMutableDictionary *event = [windowInfo mutableCopy];
            event[@"contentSource"] = @"ocr";
            event[@"contentCaptureStatus"] = status;
            NSDictionary *navigation = [self navigationForWindowInfo:windowInfo];
            if (navigation[@"fingerprint"]) event[@"navigationFingerprint"] = navigation[@"fingerprint"];
            if (navigation[@"pageCorrectionKey"]) event[@"pageCorrectionKey"] = navigation[@"pageCorrectionKey"];
            if (text.length > 0) event[@"content"] = text;
            [self.delegate firefoxTabDidCapture:event reason:reason];
            [event release];
        }
        [_capturingWindowInfo release];
        _capturingWindowInfo = nil;
        [windowInfo release];
        [reason release];
        [self startPendingCaptureIfPossible];
    }];
}

@end
