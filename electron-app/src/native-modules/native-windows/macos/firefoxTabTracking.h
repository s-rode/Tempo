#pragma once

#include <Cocoa/Cocoa.h>

@protocol FirefoxTabTrackingDelegate <NSObject>
- (void)firefoxTabDidCapture:(NSDictionary *)windowInfo reason:(NSString *)reason;
@end

@interface FirefoxTabTracking : NSObject

@property (nonatomic, assign) id<FirefoxTabTrackingDelegate> delegate;
@property (nonatomic, assign) BOOL isFirefoxActive;

- (void)beginTrackingWithInitialWindowInfo:(NSDictionary *)windowInfo;
- (void)stopFirefoxTabTimer;

@end
