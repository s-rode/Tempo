#pragma once

#import <Cocoa/Cocoa.h>

@interface TitleExtractor : NSObject

/**
 * Controls whether permission dialogs should be shown to users
 * Call this with YES after onboarding is complete
 * @param shouldRequest YES to enable permission requests, NO to disable
 */
+ (void)setShouldRequestPermissions:(BOOL)shouldRequest;

/**
 * Returns whether permission requests are currently enabled
 * @return YES if permission requests are enabled, NO otherwise
 */
+ (BOOL)shouldRequestPermissions;

/**
 * Extracts the window title for a given application name.
 * Uses multiple fallback strategies:
 * 1. CGWindowListCopyWindowInfo (fastest, most reliable)
 * 2. AppleScript via System Events (fallback for edge cases)
 * 
 * @param appName The name of the application (e.g., "Cursor", "Chrome")
 * @return The window title string, or nil if no title could be extracted
 */
+ (NSString*)extractWindowTitleForApp:(NSString*)appName;

/**
 * Extracts window title using Core Graphics Window List API
 * This is the primary method - fast and doesn't require special permissions
 */
+ (NSString*)extractTitleUsingCGWindowList:(NSString*)appName;

/**
 * Extracts window title using AppleScript and System Events
 * This is the fallback method - requires accessibility permissions
 */
+ (NSString*)extractTitleUsingAppleScript:(NSString*)appName;

/**
 * Checks if the app has the necessary permissions for title extraction
 * @return YES if permissions are available, NO otherwise
 */
+ (BOOL)hasRequiredPermissions;

/**
 * Requests the necessary permissions for title extraction
 * This will show system permission dialogs if needed
 */
+ (void)requestRequiredPermissions;

@end 