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
    BOOL _hasEmittedLoad;
    BOOL _isBuffering;
    BOOL _hasSideloadedSubs;   // el source trajo subtítulo sideloadeado (:sub-file)
    BOOL _repeat;
    NSString *_resizeMode;
    float _progressUpdateIntervalMs;
    NSTimeInterval _lastProgressEmitAt;
    char *_aspectRatioBuf;
    char *_cropGeometryBuf;
    // >= 0 mientras loadSource: está corriendo por un cambio de estilo de
    // subtítulo (no por una fuente nueva) — le dice que arranque desde acá en
    // vez de props.src.startPosition. Se resetea a -1 al usarse.
    double _liveReloadStartTime;
    // Estilo con el que se construyó el _player actual. Las opciones freetype de
    // libvlc son de INSTANCIA (no por-media), así que cambiar el estilo obliga a
    // recrear el player — comparamos contra estos para saber cuándo.
    float _builtFontScale;
    int _builtColor;
    int _builtBgOpacity;
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
        _liveReloadStartTime = -1;

        _view = [[UIView alloc] init];
        _view.backgroundColor = [UIColor blackColor];
        self.contentView = _view;

        // Player con estilo por defecto (sin opciones). El primer updateProps
        // con el estilo real lo reconstruye si difiere — ver el bloque
        // styleChanged en -updateProps:oldProps:.
        [self buildPlayerWithFontScale:0 color:0 bgOpacity:0];

        _progressUpdateIntervalMs = 250;
        _resizeMode = @"contain";
    }

    return self;
}

// (Re)crea el VLCMediaPlayer con las opciones de subtítulo a nivel de INSTANCIA.
// Las opciones freetype de libvlc (color/fondo/escala del texto) las lee el
// módulo de render al inicializarse — no son por-media, por eso hay que
// pasarlas acá y no en el VLCMedia. Cambiar el estilo obliga a recrear el
// player (ver el bloque styleChanged en -updateProps:oldProps:).
- (void)buildPlayerWithFontScale:(float)fontScale color:(int)color bgOpacity:(int)bgOpacity
{
    // Tirar abajo el player anterior si existía (cambio de estilo en caliente).
    if (_player) {
        [[NSNotificationCenter defaultCenter] removeObserver:self];
        _player.delegate = nil;
        [_player stop];
    }

    NSMutableArray<NSString *> *opts = [NSMutableArray array];
    if (fontScale > 0) {
        int scalePct = (int)lround(fontScale * 100.0); // 100 = normal
        [opts addObject:[NSString stringWithFormat:@"--sub-text-scale=%d", scalePct]];
    }
    if (color > 0) {
        [opts addObject:[NSString stringWithFormat:@"--freetype-color=%d", color]];
    }
    if (bgOpacity > 0) {
        [opts addObject:[NSString stringWithFormat:@"--freetype-background-opacity=%d", bgOpacity]];
        [opts addObject:@"--freetype-background-color=0"]; // negro
    }

    _player = opts.count > 0
        ? [[VLCMediaPlayer alloc] initWithOptions:opts]
        : [[VLCMediaPlayer alloc] init];
    _player.drawable = _view;
    _player.delegate = self;

    // Además del delegate, nos suscribimos directo a las notificaciones —
    // VLCKit expone estos nombres públicamente. Redundante con el delegate si
    // ese camino funciona, pero si por build/versión/timing no llega, esto
    // asegura que igual nos enteremos. Los handlers son idempotentes.
    [[NSNotificationCenter defaultCenter] addObserver:self
                                              selector:@selector(mediaPlayerStateChanged:)
                                                  name:VLCMediaPlayerStateChanged
                                                object:_player];
    [[NSNotificationCenter defaultCenter] addObserver:self
                                              selector:@selector(mediaPlayerTimeChanged:)
                                                  name:VLCMediaPlayerTimeChanged
                                                object:_player];

    _builtFontScale = fontScale;
    _builtColor = color;
    _builtBgOpacity = bgOpacity;
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
    _hasEmittedLoad = NO;
    _isBuffering = NO;
    _hasSideloadedSubs = NO;

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

    // Estilo de subtítulos: como son opciones de INSTANCIA, cambiar cualquiera
    // implica recrear el player. Se hace ANTES del load para que la fuente entre
    // ya con el estilo correcto. Si había video andando, se recarga en posición.
    float wantScale = newViewProps.subtitleFontScale;
    int wantColor = (int)newViewProps.subtitleColor;
    int wantBg = (int)newViewProps.subtitleBackgroundOpacity;
    BOOL styleChanged = wantScale != _builtFontScale || wantColor != _builtColor || wantBg != _builtBgOpacity;
    if (styleChanged) {
        double resumeAt = _currentUri.length > 0 ? (_player.time.intValue / 1000.0) : -1;
        [self buildPlayerWithFontScale:wantScale color:wantColor bgOpacity:wantBg];
        // Si ya había una fuente cargada y NO es que justo cambió también la uri,
        // recargarla en el nuevo player desde donde íbamos.
        if (_currentUri.length > 0 && !srcChanged) {
            _liveReloadStartTime = resumeAt;
            [self loadSource:newViewProps];
        }
    }

    if (srcChanged) {
        [self loadSource:newViewProps];
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

    // Antes de _hasEmittedLoad, selectedAudioTrack/selectedTextTrack en JS son
    // solo el placeholder inicial (-1, "todavía no sé") — no una elección real
    // del usuario. Si se aplicaran acá, el primer updateProps (con la fuente
    // recién cargada, -sub-file ya auto-seleccionado) pisaría esa selección con
    // -1 y el subtítulo/audio recién cargado se perdería sin que nadie lo haya
    // pedido. Los picks reales del usuario siempre llegan después del primer
    // load, así que este guard no bloquea ningún caso de uso real.
    if (_hasEmittedLoad && oldViewProps.selectedAudioTrack != newViewProps.selectedAudioTrack) {
        _player.currentAudioTrackIndex = newViewProps.selectedAudioTrack;
    }

    if (_hasEmittedLoad && oldViewProps.selectedTextTrack != newViewProps.selectedTextTrack) {
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
    _hasSideloadedSubs = NO;

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

    // El estilo de subtítulos NO va acá — son opciones de instancia de libvlc,
    // se aplican al crear el player (ver -buildPlayerWithFontScale:...).

    double startPos = _liveReloadStartTime >= 0 ? _liveReloadStartTime : (double)props.src.startPosition;
    _liveReloadStartTime = -1;
    if (startPos > 0) {
        [media addOption:[NSString stringWithFormat:@":start-time=%.3f", startPos]];
    }

    // Subtítulo sideloadeado: ya está descargado a disco desde JS (ver
    // downloadSpanishSubs en player.tsx) ANTES de montar, así que lo pasamos
    // como opción de media :sub-file= — se carga junto con el input y queda
    // seleccionado, sin la carrera asíncrona de addPlaybackSlave-tras-play.
    // (`sub-file` toma una ruta de archivo, no un file:// URL → lo despojamos.)
    for (const auto &t : props.src.textTracks) {
        NSString *uri = [NSString stringWithUTF8String:t.uri.c_str()];
        if (uri.length == 0) continue;
        NSString *path = [uri hasPrefix:@"file://"]
            ? [[NSURL URLWithString:uri] path]
            : uri;
        if (path.length > 0) {
            [media addOption:[NSString stringWithFormat:@":sub-file=%@", path]];
            _hasSideloadedSubs = YES;
            break; // sub-file soporta un archivo; usamos el primero (español)
        }
    }

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
        [self emitLoad];

        // El subtítulo de :sub-file se registra al abrir el input; suele estar
        // presente ya en este emitLoad, pero por si se registra unos ms después
        // reemitimos una sola vez para que el picker de JS lo refleje. Sin
        // polling: el archivo es local, no hay descarga que esperar.
        if (_hasSideloadedSubs) {
            __weak VideoVLCView *weakSelf = self;
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.6 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
                [weakSelf emitLoad];
            });
        }
    }
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
