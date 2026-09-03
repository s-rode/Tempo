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
@end

@implementation FirefoxTabTracking

- (void)dealloc {
    [self stopFirefoxTabTimer];
    [_lastKnownWindowInfo release];
    [_pendingWindowInfo release];
    [_pendingReason release];
    [_capturingWindowInfo release];
    [_navigationByWindowId release];
    [super dealloc];
}

- (NSMutableDictionary *)navigationByWindowId {
    if (!_navigationByWindowId) _navigationByWindowId = [[NSMutableDictionary alloc] init];
    return _navigationByWindowId;
}

- (NSDictionary *)frontmostFirefoxWindowInfo {
    NSRunningApplication *frontmostApp = [NSWorkspace sharedWorkspace].frontmostApplication;
    if (![frontmostApp.bundleIdentifier isEqualToString:kFirefoxBundleIdentifier]) return nil;

    pid_t pid = frontmostApp.processIdentifier;
    NSArray *windows = (__bridge_transfer NSArray *)CGWindowListCopyWindowInfo(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
        kCGNullWindowID
    );
    for (NSDictionary *window in windows) {
        if ([window[(id)kCGWindowLayer] integerValue] != 0) continue;
        if ([window[(id)kCGWindowOwnerPID] intValue] != pid) continue;
        NSNumber *windowId = window[(id)kCGWindowNumber];
        if (!windowId) continue;
        return @{
            @"id": windowId,
            @"ownerName": @"Firefox",
            @"title": window[(id)kCGWindowName] ?: @"",
            @"type": @"browser",
            @"browser": @"firefox",
        };
    }
    return nil;
}

- (BOOL)matchesCurrentFirefoxWindow:(NSDictionary *)windowInfo {
    NSDictionary *current = [self frontmostFirefoxWindowInfo];
    return current &&
      [current[@"id"] isEqual:windowInfo[@"id"]] &&
      [current[@"title"] isEqualToString:windowInfo[@"title"]];
}

- (void)startFirefoxTabTimer {
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
    NSDictionary *navigation = self.navigationByWindowId[[windowInfo[@"id"] stringValue]];
    NSString *fingerprint = navigation[@"fingerprint"];
    NSString *windowTitle = windowInfo[@"title"] ?: @"";
    if (fingerprint && [navigation[@"title"] isEqualToString:windowTitle]) {
        NSUInteger generation = ++_captureGeneration;
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            if (!self.isFirefoxActive || generation != self.captureGeneration || ![self matchesCurrentFirefoxWindow:windowInfo]) return;
            NSMutableDictionary *event = [windowInfo mutableCopy];
            event[@"navigationFingerprint"] = fingerprint;
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
    NSNumber *windowId = navigationState[@"windowId"];
    NSString *title = navigationState[@"title"];
    NSString *fingerprint = navigationState[@"navigationFingerprint"];
    if (!windowId || !title || !fingerprint) return;
    self.navigationByWindowId[[windowId stringValue]] = @{ @"title": title, @"fingerprint": fingerprint };
    NSDictionary *current = [self frontmostFirefoxWindowInfo];
    if (self.isFirefoxActive && current && [current[@"id"] isEqual:windowId] && [current[@"title"] isEqualToString:title]) {
        [self scheduleCaptureForWindowInfo:current reason:@"firefox_activation"];
    }
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
            NSDictionary *navigation = self.navigationByWindowId[[windowInfo[@"id"] stringValue]];
            if (navigation[@"fingerprint"]) event[@"navigationFingerprint"] = navigation[@"fingerprint"];
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
