// Adapted from MIT Cronus browserTabTracking at 222adf835a3a210ca5375a3876e7ed1fed31bb9e.
//
//  chromeTabTracking.h
//

#import <Foundation/Foundation.h>

@protocol ChromeTabTrackingDelegate <NSObject>
- (void)chromeTabDidSwitch:(NSDictionary *)newTabInfo;
@end

@interface ChromeTabTracking : NSObject

@property (nonatomic, assign) id<ChromeTabTrackingDelegate> delegate;
@property (nonatomic, retain) NSString *lastKnownChromeURL;
@property (nonatomic, retain) NSString *lastKnownChromeTitle;
@property (nonatomic, assign) BOOL isChromeActive;
@property (nonatomic, retain) NSTimer *chromeTabCheckTimer;
@property (nonatomic, retain) NSString *browserName;

- (void)performChromeTabCheck;
- (void)startChromeTabTimer;
- (void)stopChromeTabTimer;
- (NSDictionary*)getCurrentChromeTabBriefInfo;

@end