#pragma once

#import <Cocoa/Cocoa.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^WindowOcrCaptureCompletion)(NSString * _Nullable text, NSString *status);

@interface WindowOcrCapture : NSObject

+ (void)captureTextForWindowId:(CGWindowID)windowId
               bundleIdentifier:(NSString *)bundleIdentifier
                     completion:(WindowOcrCaptureCompletion)completion;

@end

NS_ASSUME_NONNULL_END
