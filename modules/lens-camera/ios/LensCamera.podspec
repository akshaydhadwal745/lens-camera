Pod::Spec.new do |s|
  s.name           = 'LensCamera'
  s.version        = '1.0.0'
  s.summary        = 'Pro camera for Lens: manual controls, RAW, Apple Log and analysis overlays'
  s.description    = s.summary
  s.license        = 'MIT'
  s.author         = 'Lens'
  s.homepage       = 'https://github.com/akshaydhadwal745/lens-camera'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/akshaydhadwal745/lens-camera.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation', 'CoreImage', 'Metal', 'MetalKit', 'Vision', 'ImageIO'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
