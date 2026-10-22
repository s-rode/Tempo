{
  "targets": [
    {
      "target_name": "nativeWindows",
      "cflags!": [
        "-fno-exceptions"
      ],
      "cflags_cc!": [
        "-fno-exceptions"
      ],
      "include_dirs": [
        "<!(node -p \"require('node-addon-api').include_dir\")"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS"
      ],
      "conditions": [
        [
          "OS==\"mac\"",
          {
            "sources": [
              "<!@(node -p \"require('fs').readdirSync('./macos').map(f=>'macos/'+f).join(' ')\")",
              "macos/nativeWindows.mm",
              "macos/activeWindowObserver.mm",
              "macos/sleepAndLockObserver.mm",
              "macos/titleExtractor.mm",
              "macos/permissionManager.mm"
            ],
            "libraries": [
              "-framework Cocoa",
              "-framework CoreGraphics",
              "-framework ScreenCaptureKit",
              "-framework Vision",
              "-framework EventKit"
            ],
            "xcode_settings": {
              "OTHER_CFLAGS": [
                "-fno-exceptions"
              ],
              "MACOSX_DEPLOYMENT_TARGET": "14.0"
            }
          }
        ]
      ]
    }
  ]
}
