#pragma once
#include <stdio.h>
#include <string>
#include <Cocoa/Cocoa.h>
#include <napi.h>
#import "chromeTabTracking.h"
#import "firefoxTabTracking.h"

void initActiveWindowObserver(Napi::Env env, Napi::Function windowCallback);
void stopActiveWindowObserver(Napi::Env env);
void setActivityCapturePaused(BOOL paused);
BOOL refreshActiveWindow(void);
// Clears only stale lock/sleep flags. Manual and focus-session pauses stay
// authoritative, so this recovery action cannot accidentally bypass them.
BOOL resumeAfterSystemSuspension(void);
void setFirefoxNavigationState(NSDictionary *navigationState);
void captureFirefoxNavigation(NSNumber *windowId, NSString *title, NSString *fingerprint);
void setFirefoxCompanionConnected(BOOL connected);

@interface ActiveWindowObserver: NSObject <ChromeTabTrackingDelegate, FirefoxTabTrackingDelegate>
- (id) init;
// sort of like exporting the class to the main thread
- (void) dealloc;
- (void) cleanUp;
- (void) removeWindowObserver;
- (void) receiveAppChangeNotification:(NSNotification *) notification;
- (void) sendWindowInfoToJS:(NSDictionary*)windowInfo withReason:(NSString*)reason;
- (void) handleObservedWindowInfo:(NSDictionary*)windowInfo;
- (void) handleObservedWindowInfo:(NSDictionary*)windowInfo withReason:(NSString *)reason;
- (void) scheduleCaptureForCurrentFrontmostWindowWithReason:(NSString *)reason;
- (void) scheduleCaptureForCurrentFrontmostWindowWithReason:(NSString *)reason
                                               retryAttempt:(NSUInteger)retryAttempt;
- (void) setActivityCapturePaused:(BOOL)paused;
- (void) setSystemSuspension:(NSString *)kind;
- (void) updateActivityCaptureSuspension;
- (BOOL) refreshActiveWindow;
- (BOOL) resumeAfterSystemSuspension;
- (void) setFirefoxNavigationState:(NSDictionary *)navigationState;
- (void) captureFirefoxNavigation:(NSNumber *)windowId title:(NSString *)title fingerprint:(NSString *)fingerprint;
- (void) setFirefoxCompanionConnected:(BOOL)connected;

// Internal helper methods for window content extraction
- (NSDictionary*)getActiveWindow;
@end
