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
@end

@implementation FirefoxTabTracking

- (void)dealloc {
    [self stopFirefoxTabTimer];
    [_lastKnownWindowInfo release];
    [_pendingWindowInfo release];
    [_pendingReason release];
    [_capturingWindowInfo release];
    [super dealloc];
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
    if (!windowInfo || ![self matchesCurrentFirefoxWindow:windowInfo]) return;
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
