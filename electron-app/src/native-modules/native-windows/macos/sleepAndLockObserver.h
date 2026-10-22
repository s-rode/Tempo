#pragma once
#import <Cocoa/Cocoa.h>

@class ActiveWindowObserver;

@interface SleepAndLockObserver : NSObject

- (id)initWithWindowObserver:(ActiveWindowObserver *)windowObserver;
- (void)dealloc;
- (void)stopObserving;

@end 