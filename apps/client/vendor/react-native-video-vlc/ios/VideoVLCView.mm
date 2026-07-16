#import "VideoVLCView.h"

#import <react/renderer/components/VideoVLCViewSpec/ComponentDescriptors.h>
#import <react/renderer/components/VideoVLCViewSpec/EventEmitters.h>
#import <react/renderer/components/VideoVLCViewSpec/Props.h>
#import <react/renderer/components/VideoVLCViewSpec/RCTComponentViewHelpers.h>

#import "RCTFabricComponentsPlugins.h"

#import <MobileVLCKit/MobileVLCKit.h>
#import <cstdlib>
#import <cstring>

using namespace facebook::react;

@interface VideoVLCView () <RCTVideoVLCViewViewProtocol, VLCMediaPlayerDelegate>
@end

@implementation VideoVLCView {
    UIView *_view;
    VLCMediaPlayer *_player;
    NSString *_currentUri;
    NSArray<NSDictionary *> *_pendingTextTracks;
    BOOL _hasEmittedLoad;
    BOOL _isBuffering;
    BOOL _repeat;
    NSString *_resizeMode;
    float _progressUpdateIntervalMs;
    NSTimeInterval _lastProgressEmitAt;
    char *_aspectRatioBuf;
    char *_cropGeometryBuf;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
    return concreteComponentDescriptorProvider<VideoVLCViewComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame
{
    if (self = [super initWithFrame:frame]) {
        static const auto defaultProps = std::make_shared<const VideoVLCViewProps>();
        _props = defaultProps;

        _view = [[UIView alloc] init];
        _view.backgroundColor = [UIColor blackColor];
        self.contentView = _view;

        _player = [[VLCMediaPlayer alloc] init];
        _player.drawable = _view;
        _player.delegate = self;

        _progressUpdateIntervalMs = 250;
        _resizeMode = @"contain";
    }

    return self;
}

- (void)dealloc
{
    _player.delegate = nil;
    [_player stop];
    if (_aspectRatioBuf) { free(_aspectRatioBuf); _aspectRatioBuf = NULL; }
    if (_cropGeometryBuf) { free(_cropGeometryBuf); _cropGeometryBuf = NULL; }
}

- (void)prepareForRecycle
{
    [super prepareForRecycle];
    [_player stop];
    _currentUri = nil;
    _pendingTextTracks = nil;
    _hasEmittedLoad = NO;
    _isBuffering = NO;

    static const auto defaultProps = std::make_shared<const VideoVLCViewProps>();
    _props = defaultProps;
}

- (void)layoutSubviews
{
    [super layoutSubviews];
    [self updateVideoGravity];
}

#pragma mark - Props

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
    const auto &oldViewProps = *std::static_pointer_cast<VideoVLCViewProps const>(_props);
    const auto &newViewProps = *std::static_pointer_cast<VideoVLCViewProps const>(props);

    BOOL srcChanged = oldViewProps.src.uri != newViewProps.src.uri;

    if (srcChanged) {
        [self loadSource:newViewProps];
    } else if (oldViewProps.src.textTracks.size() != newViewProps.src.textTracks.size() && _hasEmittedLoad) {
        for (const auto &t : newViewProps.src.textTracks) {
            NSString *uri = [NSString stringWithUTF8String:t.uri.c_str()];
            NSURL *url = uri.length > 0 ? [NSURL URLWithString:uri] : nil;
            if (url) {
                [_player addPlaybackSlave:url type:VLCMediaPlaybackSlaveTypeSubtitle enforce:NO];
            }
        }
    }

    if (oldViewProps.paused != newViewProps.paused) {
        if (newViewProps.paused) {
            [_player pause];
        } else {
            [_player play];
        }
    }

    if (oldViewProps.muted != newViewProps.muted) {
        _player.audio.muted = newViewProps.muted;
    }

    if (oldViewProps.volume != newViewProps.volume) {
        _player.audio.volume = newViewProps.volume > 0 ? newViewProps.volume : 100;
    }

    if (oldViewProps.selectedAudioTrack != newViewProps.selectedAudioTrack) {
        _player.currentAudioTrackIndex = newViewProps.selectedAudioTrack;
    }

    if (oldViewProps.selectedTextTrack != newViewProps.selectedTextTrack) {
        _player.currentVideoSubTitleIndex = newViewProps.selectedTextTrack;
    }

    if (oldViewProps.textTrackDelay != newViewProps.textTrackDelay) {
        _player.currentVideoSubTitleDelay = (NSInteger)newViewProps.textTrackDelay * 1000000;
    }

    if (oldViewProps.progressUpdateInterval != newViewProps.progressUpdateInterval) {
        _progressUpdateIntervalMs = newViewProps.progressUpdateInterval > 0 ? newViewProps.progressUpdateInterval : 250;
    }

    if (oldViewProps.repeat != newViewProps.repeat) {
        _repeat = newViewProps.repeat;
    }

    if (oldViewProps.resizeMode != newViewProps.resizeMode) {
        _resizeMode = [NSString stringWithUTF8String:newViewProps.resizeMode.c_str()];
        [self updateVideoGravity];
    }

    [super updateProps:props oldProps:oldProps];
}

- (void)loadSource:(const VideoVLCViewProps &)props
{
    [_player stop];
    _hasEmittedLoad = NO;
    _isBuffering = NO;
    _pendingTextTracks = nil;

    NSString *uriString = [NSString stringWithUTF8String:props.src.uri.c_str()];
    if (uriString.length == 0) {
        _currentUri = nil;
        _player.media = nil;
        return;
    }
    _currentUri = uriString;

    NSURL *url = [NSURL URLWithString:uriString];
    if (!url) {
        [self emitError:@"URL inválida" code:-1];
        return;
    }

    [self emitLoadStart];

    VLCMedia *media = [VLCMedia mediaWithURL:url];

    for (const auto &header : props.src.requestHeaders) {
        NSString *key = [NSString stringWithUTF8String:header.key.c_str()].lowercaseString;
        NSString *value = [NSString stringWithUTF8String:header.value.c_str()];
        if ([key isEqualToString:@"referer"]) {
            [media addOption:[NSString stringWithFormat:@":http-referrer=%@", value]];
        } else if ([key isEqualToString:@"user-agent"]) {
            [media addOption:[NSString stringWithFormat:@":http-user-agent=%@", value]];
        }
    }

    for (const auto &opt : props.src.mediaOptions) {
        NSString *option = [NSString stringWithUTF8String:opt.c_str()];
        if (option.length > 0) {
            [media addOption:option];
        }
    }

    if (props.src.startPosition > 0) {
        [media addOption:[NSString stringWithFormat:@":start-time=%.3f", (double)props.src.startPosition]];
    }

    NSMutableArray<NSDictionary *> *pending = [NSMutableArray array];
    for (const auto &t : props.src.textTracks) {
        NSString *uri = [NSString stringWithUTF8String:t.uri.c_str()];
        if (uri.length > 0) {
            [pending addObject:@{@"uri": uri}];
        }
    }
    _pendingTextTracks = pending;

    _player.media = media;

    if (!props.paused) {
        [_player play];
    }
}

- (void)updateVideoGravity
{
    if (!_player) return;
    CGSize viewSize = _view.bounds.size;
    if (viewSize.width < 1 || viewSize.height < 1) return;

    _player.videoAspectRatio = NULL;
    _player.videoCropGeometry = NULL;
    if (_aspectRatioBuf) { free(_aspectRatioBuf); _aspectRatioBuf = NULL; }
    if (_cropGeometryBuf) { free(_cropGeometryBuf); _cropGeometryBuf = NULL; }

    NSString *ratioStr = [NSString stringWithFormat:@"%d:%d", (int)viewSize.width, (int)viewSize.height];

    if ([_resizeMode isEqualToString:@"stretch"]) {
        _aspectRatioBuf = strdup(ratioStr.UTF8String);
        _player.videoAspectRatio = _aspectRatioBuf;
    } else if ([_resizeMode isEqualToString:@"cover"]) {
        _cropGeometryBuf = strdup(ratioStr.UTF8String);
        _player.videoCropGeometry = _cropGeometryBuf;
    }
    // 'contain' (default): leave NULL -> VLC scales to fit preserving aspect ratio
}

#pragma mark - Commands

- (void)seek:(float)time
{
    if (!_player) return;
    _player.time = [VLCTime timeWithInt:(int)(time * 1000.0f)];
}

#pragma mark - VLCMediaPlayerDelegate

- (void)mediaPlayerStateChanged:(NSNotification *)aNotification
{
    if (!_player) return;
    VLCMediaPlayerState state = _player.state;

    switch (state) {
        case VLCMediaPlayerStateBuffering:
        case VLCMediaPlayerStateOpening:
            if (!_isBuffering) {
                _isBuffering = YES;
                [self emitBuffering:YES];
            }
            break;
        case VLCMediaPlayerStatePlaying:
            if (_isBuffering) {
                _isBuffering = NO;
                [self emitBuffering:NO];
            }
            if (!_hasEmittedLoad) {
                _hasEmittedLoad = YES;
                [self applyPendingTextTracks];
                [self emitLoad];
            }
            break;
        case VLCMediaPlayerStateError:
            [self emitError:@"Error de reproducción VLC" code:(int)state];
            break;
        case VLCMediaPlayerStateEnded:
            [self emitEnd];
            if (_repeat) {
                _player.time = [VLCTime timeWithInt:0];
                [_player play];
            }
            break;
        default:
            break;
    }
}

- (void)mediaPlayerTimeChanged:(NSNotification *)aNotification
{
    if (!_player || !_hasEmittedLoad) return;

    NSTimeInterval now = CACurrentMediaTime() * 1000.0;
    if (now - _lastProgressEmitAt < _progressUpdateIntervalMs) return;
    _lastProgressEmitAt = now;

    [self emitProgress];
}

#pragma mark - Track application

- (void)applyPendingTextTracks
{
    if (_pendingTextTracks.count == 0) return;
    for (NSDictionary *track in _pendingTextTracks) {
        NSURL *url = [NSURL URLWithString:track[@"uri"]];
        if (url) {
            [_player addPlaybackSlave:url type:VLCMediaPlaybackSlaveTypeSubtitle enforce:YES];
        }
    }
    _pendingTextTracks = nil;
}

#pragma mark - Event emission

- (std::shared_ptr<VideoVLCViewEventEmitter const>)videoEventEmitter
{
    return std::static_pointer_cast<VideoVLCViewEventEmitter const>(_eventEmitter);
}

- (void)emitLoadStart
{
    auto emitter = [self videoEventEmitter];
    if (emitter) emitter->onVideoLoadStart({});
}

- (void)emitBuffering:(BOOL)isBuffering
{
    auto emitter = [self videoEventEmitter];
    if (emitter) emitter->onVideoBuffer({.isBuffering = (bool)isBuffering});
}

- (void)emitEnd
{
    auto emitter = [self videoEventEmitter];
    if (emitter) emitter->onVideoEnd({});
}

- (void)emitError:(NSString *)message code:(int)code
{
    auto emitter = [self videoEventEmitter];
    if (!emitter) return;
    emitter->onVideoError({
        .error = {
            .errorString = std::string(message.UTF8String ?: "VLC error"),
            .errorCode = code,
        },
    });
}

- (void)emitProgress
{
    auto emitter = [self videoEventEmitter];
    if (!emitter) return;

    float currentSec = _player.time.intValue / 1000.0f;
    float durationSec = _player.media.length.intValue / 1000.0f;
    float progress = durationSec > 0 ? (currentSec / durationSec) : 0;

    emitter->onVideoProgress({
        .currentTime = currentSec,
        .seekableDuration = durationSec,
        .progress = progress,
    });
}

- (void)emitLoad
{
    auto emitter = [self videoEventEmitter];
    if (!emitter) return;

    CGSize videoSize = _player.videoSize;
    auto orientation = VideoVLCViewEventEmitter::OnVideoLoadNaturalSizeOrientation::Landscape;
    if (videoSize.width > 0 && videoSize.height > 0) {
        if (videoSize.width == videoSize.height) {
            orientation = VideoVLCViewEventEmitter::OnVideoLoadNaturalSizeOrientation::Square;
        } else if (videoSize.height > videoSize.width) {
            orientation = VideoVLCViewEventEmitter::OnVideoLoadNaturalSizeOrientation::Portrait;
        }
    }

    std::vector<VideoVLCViewEventEmitter::OnVideoLoadAudioTracks> audioTracks;
    NSArray *audioIndexes = _player.audioTrackIndexes;
    NSArray *audioNames = _player.audioTrackNames;
    int currentAudioIdx = _player.currentAudioTrackIndex;
    for (NSUInteger i = 0; i < audioIndexes.count; i++) {
        int trackId = [audioIndexes[i] intValue];
        if (trackId < 0) continue;
        NSString *name = i < audioNames.count ? audioNames[i] : @"";
        audioTracks.push_back({
            .id = trackId,
            .selected = trackId == currentAudioIdx,
            .title = std::string(name.UTF8String ?: ""),
            .language = "",
        });
    }

    std::vector<VideoVLCViewEventEmitter::OnVideoLoadTextTracks> textTracks;
    NSArray *subIndexes = _player.videoSubTitlesIndexes;
    NSArray *subNames = _player.videoSubTitlesNames;
    int currentSubIdx = _player.currentVideoSubTitleIndex;
    for (NSUInteger i = 0; i < subIndexes.count; i++) {
        int trackId = [subIndexes[i] intValue];
        if (trackId < 0) continue;
        NSString *name = i < subNames.count ? subNames[i] : @"";
        textTracks.push_back({
            .id = trackId,
            .selected = trackId == currentSubIdx,
            .title = std::string(name.UTF8String ?: ""),
            .language = "",
        });
    }

    std::vector<VideoVLCViewEventEmitter::OnVideoLoadVideoTracks> videoTracks;
    NSArray *vIndexes = _player.videoTrackIndexes;
    NSArray *vNames = _player.videoTrackNames;
    int currentVideoIdx = _player.currentVideoTrackIndex;
    for (NSUInteger i = 0; i < vIndexes.count; i++) {
        int trackId = [vIndexes[i] intValue];
        if (trackId < 0) continue;
        NSString *name = i < vNames.count ? vNames[i] : @"";
        videoTracks.push_back({
            .id = trackId,
            .selected = trackId == currentVideoIdx,
            .title = std::string(name.UTF8String ?: ""),
            .language = "",
        });
    }

    float durationSec = _player.media.length.intValue / 1000.0f;
    float currentSec = _player.time.intValue / 1000.0f;

    emitter->onVideoLoad({
        .currentTime = currentSec,
        .duration = durationSec,
        .naturalSize = {
            .width = (Float)videoSize.width,
            .height = (Float)videoSize.height,
            .orientation = orientation,
        },
        .videoTracks = videoTracks,
        .audioTracks = audioTracks,
        .textTracks = textTracks,
    });
}

Class<RCTComponentViewProtocol> VideoVLCViewCls(void)
{
    return VideoVLCView.class;
}

@end
