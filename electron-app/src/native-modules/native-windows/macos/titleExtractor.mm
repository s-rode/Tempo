#import "titleExtractor.h"
#import "permissionManager.h"
#import <ApplicationServices/ApplicationServices.h>

// Logging macro - you may want to adjust this based on your logging setup
#define MyLog(...) do {} while (0)

@implementation TitleExtractor

+ (void)setShouldRequestPermissions:(BOOL)shouldRequest {
    [PermissionManager setShouldRequestPermissions:shouldRequest];
}

+ (BOOL)shouldRequestPermissions {
    return [PermissionManager shouldRequestPermissions];
}

+ (NSString*)extractWindowTitleForApp:(NSString*)appName {
    if (!appName || appName.length == 0) {
        MyLog(@"❌ Invalid app name provided");
        return nil;
    }
    
    MyLog(@"🔍 Extracting window title for app: %@", appName);
    
    // Try primary method first (CGWindowList) - doesn't require permissions
    NSString *title = [self extractTitleUsingCGWindowList:appName];
    if (title && title.length > 0) {
        return title;
    }
    
    // Check if we should request permissions before trying AppleScript
    if (![PermissionManager hasPermissionsForTitleExtraction] && [PermissionManager shouldRequestPermissions]) {
        MyLog(@"🔑 Requesting accessibility permissions for AppleScript fallback");
        [PermissionManager requestPermission:PermissionTypeAccessibility completion:^(PermissionStatus status) {
            MyLog(@"📋 Accessibility permission request completed with status: %ld", (long)status);
        }];
    }
    
    // Try AppleScript fallback (requires permissions, but may work if already granted)
    MyLog(@"🔄 CGWindowList failed, trying AppleScript fallback for app: %@", appName);
    return [self extractTitleUsingAppleScript:appName];
}

// Core Graphics ownership is explicit because this addon uses manual reference counting.
+ (NSString*)extractTitleUsingCGWindowList:(NSString*)appName {
    CFArrayRef snapshot = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID);
    if (snapshot == NULL) return nil;
    NSString *result = nil;
    for (NSDictionary *entry in (NSArray *)snapshot) {
        if (![entry[(id)kCGWindowOwnerName] isEqualToString:appName]) continue;
        if ([entry[(id)kCGWindowLayer] integerValue] > 0) continue;
        NSString *candidate = entry[(id)kCGWindowName];
        if (candidate.length == 0) continue;
        result = [candidate copy];
        break;
    }
    CFRelease(snapshot);
    return [result autorelease];
}

+ (NSString*)extractTitleUsingAppleScript:(NSString*)appName {
    // Check if permission requests are enabled before executing AppleScript
    if (![PermissionManager shouldRequestPermissions]) {
        MyLog(@"🍎 AppleScript approach skipped - permission requests disabled during onboarding");
        return nil;
    }

    // System Events UI scripting reads AX attributes. From an untrusted
    // process macOS answers with its Accessibility / Device Control prompt,
    // and this runs for every untitled window (for example PDFgear), so the
    // prompt would recur indefinitely. Accessibility is an optional fallback:
    // only use it when the user has already granted it.
    if (!AXIsProcessTrusted()) {
        return nil;
    }

    @try {
        MyLog(@"🍎 Using AppleScript approach for app: %@", appName);
        
        // Create AppleScript to get the frontmost window title
        NSString *scriptSource = [NSString stringWithFormat:@
            "tell application \"System Events\"\n"
            "    try\n"
            "        set frontApp to first process whose frontmost is true\n"
            "        if name of frontApp is \"%@\" then\n"
            "            tell process \"%@\"\n"
            "                try\n"
            "                    set frontWindow to first window whose value of attribute \"AXMain\" is true\n"
            "                    return value of attribute \"AXTitle\" of frontWindow\n"
            "                on error\n"
            "                    return \"\"\n"
            "                end try\n"
            "            end tell\n"
            "        end if\n"
            "    on error\n"
            "        return \"\"\n"
            "    end try\n"
            "end tell", appName, appName];
        
        NSAppleScript *script = [[NSAppleScript alloc] initWithSource:scriptSource];
        NSDictionary *errorDict = nil;
        NSAppleEventDescriptor *result = [script executeAndReturnError:&errorDict];
        
        if (errorDict) {
            MyLog(@"❌ AppleScript execution error: %@", errorDict);
            return nil;
        }
        
        if (result && [result descriptorType] == typeUnicodeText) {
            NSString *title = [result stringValue];
            if (title && title.length > 0) {
                MyLog(@"🎯 Found window title via AppleScript: '%@' for app: %@", title, appName);
                return [title copy];
            }
        }
        
        MyLog(@"⚠️  No window title found via AppleScript for app: %@", appName);
        
    } @catch (NSException *exception) {
        MyLog(@"❌ Exception in AppleScript approach: %@", exception.reason);
    }
    
    return nil;
}

+ (BOOL)hasRequiredPermissions {
    return [PermissionManager hasPermissionsForTitleExtraction];
}

+ (void)requestRequiredPermissions {
    MyLog(@"🔑 Requesting required permissions for title extraction via PermissionManager");
    [PermissionManager requestPermission:PermissionTypeAccessibility completion:^(PermissionStatus status) {
        MyLog(@"📋 Title extraction permission request completed with status: %ld", (long)status);
    }];
}

@end
