require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "VideoVLC"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/pigeonmal/react-native-video-vlc"
  s.license      = "MIT"
  s.authors      = "bmo"

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/pigeonmal/react-native-video-vlc.git", :tag => "#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift,cpp}"
  s.private_header_files = "ios/**/*.h"

  s.dependency "MobileVLCKit", "3.7.3"

  install_modules_dependencies(s)
end
