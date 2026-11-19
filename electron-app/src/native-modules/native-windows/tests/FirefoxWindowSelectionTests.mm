// Run with `bun run test:firefox-window-selection` on macOS.
#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>

#import "../macos/firefoxWindowSelection.h"

static int failures = 0;

static void expect(BOOL condition, NSString *name) {
    if (condition) return;
    failures++;
    fprintf(stderr, "FAIL: %s\n", name.UTF8String);
}

static NSDictionary *window(int windowId, int pid, int layer, NSString *title, CGRect bounds) {
    NSMutableDictionary *record = [NSMutableDictionary dictionary];
    record[(id)kCGWindowNumber] = @(windowId);
    record[(id)kCGWindowOwnerPID] = @(pid);
    record[(id)kCGWindowLayer] = @(layer);
    if (title) record[(id)kCGWindowName] = title;
    CFDictionaryRef rect = CGRectCreateDictionaryRepresentation(bounds);
    record[(id)kCGWindowBounds] = (NSDictionary *)rect;
    CFRelease(rect);
    return record;
}

int main() {
    @autoreleasepool {
        const pid_t firefox = 42;
        const CGRect screen = CGRectMake(0, 0, 1512, 982);

        NSArray *windowed = @[
            window(10, firefox, 0, @"Lecture 4 – YouTube", CGRectMake(100, 100, 1200, 800)),
            window(11, firefox, 0, @"Other window", CGRectMake(150, 150, 1200, 800)),
        ];
        expect([FirefoxSelectPageWindow(windowed, firefox)[@"id"] isEqual:@10],
               @"ordinary window: frontmost titled window wins");

        NSArray *nativeFullScreen = @[
            window(20, firefox, 0, @"", CGRectMake(0, 0, 1512, 52)),
            window(21, firefox, 0, @"Lecture 4 – YouTube", screen),
        ];
        NSDictionary *selected = FirefoxSelectPageWindow(nativeFullScreen, firefox);
        expect([selected[@"id"] isEqual:@21], @"full screen: skips untitled title-bar strip");
        expect([selected[@"title"] hasPrefix:@"Lecture 4"], @"full screen: keeps page title");

        NSArray *domFullScreenTransition = @[
            window(30, firefox, 0, nil, screen),
            window(31, firefox, 0, @"Lecture 4 – YouTube", screen),
        ];
        expect([FirefoxSelectPageWindow(domFullScreenTransition, firefox)[@"id"] isEqual:@31],
               @"video full screen: titled page window behind untitled overlay wins");

        NSArray *otherProcessesAndLayers = @[
            window(40, 7, 0, @"Notes", screen),
            window(41, firefox, 101, @"Popup", CGRectMake(10, 10, 400, 300)),
            window(42, firefox, 0, @"Page", screen),
        ];
        expect([FirefoxSelectPageWindow(otherProcessesAndLayers, firefox)[@"id"] isEqual:@42],
               @"ignores other processes and non-zero layers");

        NSArray *noTitles = @[
            window(50, firefox, 0, @"", CGRectMake(0, 0, 1512, 52)),
            window(51, firefox, 0, @"", screen),
        ];
        expect([FirefoxSelectPageWindow(noTitles, firefox)[@"id"] isEqual:@51],
               @"no titles: largest page-sized window is used");

        NSArray *onlyStrip = @[ window(60, firefox, 0, @"", CGRectMake(0, 0, 1512, 52)) ];
        expect([FirefoxSelectPageWindow(onlyStrip, firefox)[@"id"] isEqual:@60],
               @"only helper windows: falls back to the frontmost one");

        expect(FirefoxSelectPageWindow(@[], firefox) == nil, @"no windows: nil");
    }
    if (failures > 0) return 1;
    printf("Firefox window selection tests passed\n");
    return 0;
}
