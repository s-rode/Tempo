#import "firefoxWindowSelection.h"

#import <CoreGraphics/CoreGraphics.h>

// Smaller than any usable Firefox browser window, larger than the full-screen
// title-bar strip and Firefox's full-screen warning panel.
static const CGFloat kMinimumPageWindowWidth = 160;
static const CGFloat kMinimumPageWindowHeight = 120;

NSDictionary *FirefoxSelectPageWindow(NSArray *windows, pid_t pid) {
    NSDictionary *firstWindow = nil;
    NSDictionary *largestUntitledWindow = nil;
    CGFloat largestUntitledArea = -1;
    for (NSDictionary *window in windows) {
        if (![window isKindOfClass:[NSDictionary class]]) continue;
        if ([window[(id)kCGWindowLayer] integerValue] != 0) continue;
        if ([window[(id)kCGWindowOwnerPID] intValue] != pid) continue;
        NSNumber *windowId = window[(id)kCGWindowNumber];
        if (![windowId isKindOfClass:[NSNumber class]]) continue;
        id rawTitle = window[(id)kCGWindowName];
        NSString *title = [rawTitle isKindOfClass:[NSString class]] ? (NSString *)rawTitle : @"";
        NSDictionary *record = @{ @"id": windowId, @"title": title };
        if (!firstWindow) firstWindow = record;

        CGRect bounds = CGRectZero;
        NSDictionary *rawBounds = window[(id)kCGWindowBounds];
        BOOL hasBounds = [rawBounds isKindOfClass:[NSDictionary class]] &&
          CGRectMakeWithDictionaryRepresentation((CFDictionaryRef)rawBounds, &bounds);
        if (hasBounds &&
            (bounds.size.width < kMinimumPageWindowWidth || bounds.size.height < kMinimumPageWindowHeight)) continue;

        // The list is front-to-back, so the first titled page-sized window is
        // the one the user is looking at.
        if (title.length > 0) return record;
        CGFloat area = hasBounds ? bounds.size.width * bounds.size.height : 0;
        if (area > largestUntitledArea) {
            largestUntitledArea = area;
            largestUntitledWindow = record;
        }
    }
    return largestUntitledWindow ?: firstWindow;
}
