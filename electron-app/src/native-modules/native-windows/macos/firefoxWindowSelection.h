#pragma once

#import <Foundation/Foundation.h>
#include <sys/types.h>

// Picks the window that shows Firefox's current page from a front-to-back
// CGWindowList snapshot. Returns @{ @"id": NSNumber, @"title": NSString }, or
// nil when the process has no layer-0 window on screen.
//
// In macOS full screen Firefox owns more than one layer-0 window: AppKit adds
// an untitled title-bar/tab-strip window, and DOM full screen (a lecture video)
// briefly adds a transition window and a warning panel. These can be ordered
// in front of the page window, so "first layer-0 window" would yield an empty
// title, which loses the companion's navigation match and the page context.
NSDictionary *FirefoxSelectPageWindow(NSArray *windows, pid_t pid);
