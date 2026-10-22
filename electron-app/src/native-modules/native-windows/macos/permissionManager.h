#pragma once

#import <Cocoa/Cocoa.h>

typedef NS_ENUM(NSInteger, PermissionType) {
    PermissionTypeAccessibility,
    PermissionTypeAppleEvents,
    PermissionTypeScreenRecording
};

typedef NS_ENUM(NSInteger, PermissionStatus) {
    PermissionStatusDenied,
    PermissionStatusGranted,
    PermissionStatusPending
};

@interface PermissionManager : NSObject

/**
 * Singleton instance
 */
+ (instancetype)sharedManager;

/**
 * Controls whether explicit permission dialogs should be shown to users
 * Call this with YES after onboarding is complete to enable explicit permission requests
 * 
 * IMPORTANT: This does NOT prevent automatic system permission dialogs that occur
 * when protected APIs are first used (like AXObserverCreate or AppleScript execution).
 * This only controls explicit calls to requestPermission:completion:
 */
+ (void)setShouldRequestPermissions:(BOOL)shouldRequest;

/**
 * Returns whether explicit permission requests are currently enabled
 * This does NOT indicate whether automatic system dialogs are prevented
 */
+ (BOOL)shouldRequestPermissions;

/**
 * Checks if a specific permission is granted
 */
+ (PermissionStatus)statusForPermission:(PermissionType)permissionType;

/**
 * Requests a specific permission with intelligent sequencing
 * This will queue permissions and show them one at a time
 */
+ (void)requestPermission:(PermissionType)permissionType 
               completion:(void(^)(PermissionStatus status))completion;

/**
 * Requests multiple permissions in sequence (not simultaneously)
 */
+ (void)requestPermissions:(NSArray<NSNumber*>*)permissionTypes 
                completion:(void(^)(NSDictionary<NSNumber*, NSNumber*>* results))completion;

/**
 * Check if we have all required permissions for a specific feature
 */
+ (BOOL)hasPermissionsForTitleExtraction;
+ (BOOL)hasPermissionsForContentExtraction;

@end 