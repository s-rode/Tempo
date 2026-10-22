#import "appFilter.h"
#include <stdio.h> // For fprintf, stderr

#define MyLog(...) do {} while (0)

BOOL shouldExcludeApp(NSString* ownerName, NSString* title) {
    if (!ownerName) return NO;
    
    // First check: Exclude system UI elements
    if ([ownerName isEqualToString:@"Dock"] ||
        [ownerName isEqualToString:@"Finder"] ||
        [ownerName isEqualToString:@"SystemUIServer"] ||
        [ownerName isEqualToString:@"WindowManager"]) {
        MyLog(@"🚫 Excluding system UI element: %@", ownerName);
        return YES;
    }
    
    return NO;
} 