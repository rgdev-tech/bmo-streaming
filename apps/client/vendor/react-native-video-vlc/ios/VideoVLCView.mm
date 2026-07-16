#import "VideoVLCView.h"

#import <react/renderer/components/VideoVLCViewSpec/ComponentDescriptors.h>
#import <react/renderer/components/VideoVLCViewSpec/EventEmitters.h>
#import <react/renderer/components/VideoVLCViewSpec/Props.h>
#import <react/renderer/components/VideoVLCViewSpec/RCTComponentViewHelpers.h>

#import "RCTFabricComponentsPlugins.h"

#import <MobileVLCKit/MobileVLCKit.h>
#import <cstdlib>
#import <cstring>
#import <cmath>

using namespace facebook::react;

// VLCKit puede poner NSNull (u otro tipo) en vez de un NSString/NSNumber real
// para pistas sin nombre — llamar .UTF8String/.intValue directo sobre eso
// manda un selector no reconocido y crashea. Estos helpers lo evitan.
static NSString *VideoVLCSafeTrackName(NSArray *names, NSUInteger i) {
    if (i >= names.count) return @"";
    id value = names[i];
    return [value isKindOfClass:[NSString class]] ? (NSString *)value : @"";
}

static int VideoVLCSafeTrackId(NSArray *indexes, NSUInteger i) {
    if (i >= indexes.count) return -1;
    id value = indexes[i];
    return [value isKindOfClass:[NSNumber class]] ? [(NSNumber *)value intValue] : -1;
}

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

        // Además del delegate, nos suscribimos directo a las notificaciones —
        // VLCKit expone estos nombres públicamente para esto. Es redundante con
        // el delegate si ese camino funciona, pero si por lo que sea no llega
        // (build/versión/timing), esto asegura que igual nos enteremos. Los
        // handlers son idempotentes (guardados por _hasEmittedLoad/_isBuffering)
        // así que llamadas duplicadas no rompen nada.
        [[NSNotificationCenter defaultCenter] addObserver:self
                                                  selector:@selector(mediaPlayerStateChanged:)
                                                      name:VLCMediaPlayerStateChanged
                                                    object:_player];
        [[NSNotificationCenter defaultCenter] addObserver:self
                                                  selector:@selector(mediaPlayerTimeChanged:)
                                                      name:VLCMediaPlayerTimeChanged
                                                    object:_player];

        _progressUpdateIntervalMs = 250;
        _resizeMode = @"contain";
    }

    return self;
}

- (void)dealloc
{
    [[NSNotificationCenter defaultCenter] removeObserver:self];
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

// Fabric no invoca -seek: automáticamente solo porque existe el protocolo —
// necesita que este view override -handleCommand:args: y reenvíe al helper
// generado por el codegen. Sin esto, el comando "seek" se pierde en silencio:
// el dispatch desde JS no tira error (no tiene forma de saber que nadie lo
// atendió del lado nativo), simplemente no pasa nada.
- (void)handleCommand:(const NSString *)commandName args:(const NSArray *)args
{
    RCTVideoVLCViewHandleCommand(self, commandName, args);
}

- (void)seek:(float)time
{
    if (!_player) return;
    // jumpForward:/jumpBackward: no necesitan target absoluto ni duración,
    // solo un delta desde la posición actual — se lo calculamos.
    float currentSec = _player.time.intValue / 1000.0f;
    int delta = (int)lroundf(time - currentSec);
    if (delta > 0) {
        [_player jumpForward:delta];
    } else if (delta < 0) {
        [_player jumpBackward:-delta];
    }
}

#pragma mark - VLCMediaPlayerDelegate

// Delegate y NSNotificationCenter pueden llamar a estos métodos desde hilos
// distintos (y potencialmente en simultáneo, ya que nos suscribimos a ambos
// caminos). Todo el trabajo real se serializa en el hilo principal para
// eliminar carreras sobre los ivars compartidos y porque tocar el emitter/UI
// desde un hilo de fondo no es seguro.

- (void)mediaPlayerStateChanged:(NSNotification *)aNotification
{
    dispatch_async(dispatch_get_main_queue(), ^{
        [self handleStateChanged];
    });
}

- (void)mediaPlayerTimeChanged:(NSNotification *)aNotification
{
    dispatch_async(dispatch_get_main_queue(), ^{
        [self handleTimeChanged];
    });
}

- (void)handleStateChanged
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
            _isBuffering = NO;
            [self tryEmitLoadAndClearBuffering];
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

- (void)handleTimeChanged
{
    if (!_player) return;

    // No confiar en _player.state == Playing acá: para streams de red VLC puede
    // seguir reportando Buffering aunque ya esté decodificando/mostrando cuadros.
    // Que time-changed dispare implica que hay progreso real, así que lo tomamos
    // como la señal de "ya está andando" — también cubre el caso en que Fabric
    // no había entregado el eventEmitter todavía cuando llegó Playing (reintenta
    // en cada tick hasta que el emitter exista).
    if (!_hasEmittedLoad) {
        [self tryEmitLoadAndClearBuffering];
    }

    if (!_hasEmittedLoad) return;

    NSTimeInterval now = CACurrentMediaTime() * 1000.0;
    if (now - _lastProgressEmitAt < _progressUpdateIntervalMs) return;
    _lastProgressEmitAt = now;

    [self emitProgress];
}

- (void)tryEmitLoadAndClearBuffering
{
    auto emitter = [self videoEventEmitter];
    if (!emitter) return; // reintentará en el próximo mediaPlayerTimeChanged:

    emitter->onVideoBuffer({.isBuffering = false});

    if (!_hasEmittedLoad) {
        _hasEmittedLoad = YES;
        BOOL hadPendingTextTracks = _pendingTextTracks.count > 0;
        [self applyPendingTextTracks];
        [self emitLoad];

        // addPlaybackSlave: no registra la pista de forma instantánea (todavía
        // tiene que bajar y parsear el archivo) — si emitLoad corrió antes de
        // que termine, la lista de subtítulos sale vacía en el primer aviso.
        // Reemitimos un rato después, ya con lo que haya terminado de cargar.
        if (hadPendingTextTracks) {
            __weak VideoVLCView *weakSelf = self;
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.2 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
                [weakSelf emitLoad];
            });
        }
    }
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
        int trackId = VideoVLCSafeTrackId(audioIndexes, i);
        if (trackId < 0) continue;
        NSString *name = VideoVLCSafeTrackName(audioNames, i);
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
        int trackId = VideoVLCSafeTrackId(subIndexes, i);
        if (trackId < 0) continue;
        NSString *name = VideoVLCSafeTrackName(subNames, i);
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
        int trackId = VideoVLCSafeTrackId(vIndexes, i);
        if (trackId < 0) continue;
        NSString *name = VideoVLCSafeTrackName(vNames, i);
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
