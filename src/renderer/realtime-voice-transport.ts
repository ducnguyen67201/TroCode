import type {
  CreateVoiceCallRequest,
  VoiceCallAnswer,
} from '../shared/contracts';

const CONNECTION_TIMEOUT_MS = 12_000;

export interface RealtimeVoiceTransport {
  channel: RTCDataChannel;
  connection: RTCPeerConnection;
  releasePlaceholderAudio?: () => void;
  sender: RTCRtpSender;
}

export interface RealtimeVoicePlaceholderAudio {
  release(): void;
  stream: MediaStream;
  track: MediaStreamTrack;
}

export interface OutboundAudioStats {
  bytesSent: number;
  packetsSent: number;
}

export interface RealtimeVoiceTransportDependencies {
  audioTrack?: MediaStreamTrack;
  createPlaceholderAudio?: () => RealtimeVoicePlaceholderAudio;
  createVoiceCall?: (
    request: CreateVoiceCallRequest,
  ) => Promise<VoiceCallAnswer>;
  createPeerConnection?: () => RTCPeerConnection;
  diagnosticLogger?: VoiceDiagnosticLogger;
}

type VoiceDiagnosticProperties = Record<
  string,
  string | number | boolean
>;

type VoiceDiagnosticLogger = (
  event: string,
  properties?: VoiceDiagnosticProperties,
) => void;

const SECRET_PATTERN = /\b(?:ek|sk)[-_][a-z0-9._-]+/gi;

export function logRealtimeVoiceDiagnostic(
  event: string,
  properties: VoiceDiagnosticProperties = {},
): void {
  const details =
    Object.keys(properties).length > 0
      ? ` ${JSON.stringify(properties)}`
      : '';
  console.info(`[voice:renderer] ${event}${details}`);
}

export async function readOutboundAudioStats(
  sender: RTCRtpSender,
): Promise<OutboundAudioStats> {
  const report = await sender.getStats();
  const totals: OutboundAudioStats = { bytesSent: 0, packetsSent: 0 };

  report.forEach((stats: RTCStats) => {
    if (stats.type !== 'outbound-rtp') return;
    const outbound = stats as RTCOutboundRtpStreamStats & {
      mediaType?: string;
    };
    if ((outbound.kind ?? outbound.mediaType) !== 'audio') return;
    totals.bytesSent += outbound.bytesSent ?? 0;
    totals.packetsSent += outbound.packetsSent ?? 0;
  });

  return totals;
}

function createSilentPlaceholderAudio(): RealtimeVoicePlaceholderAudio {
  const context = new AudioContext();
  const source = context.createConstantSource();
  const destination = context.createMediaStreamDestination();
  source.offset.value = 0;
  source.connect(destination);
  source.start();
  void context.resume().catch(() => undefined);

  const track = destination.stream.getAudioTracks()[0];
  if (!track) {
    source.stop();
    source.disconnect();
    void context.close().catch(() => undefined);
    throw new Error('Could not create the warm voice audio sender.');
  }

  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      track.stop();
      source.stop();
      source.disconnect();
      destination.disconnect();
      void context.close().catch(() => undefined);
    },
    stream: destination.stream,
    track,
  };
}

function diagnosticErrorProperties(
  error: unknown,
): VoiceDiagnosticProperties {
  const name = error instanceof Error ? error.name : 'UnknownError';
  const rawMessage =
    error instanceof Error ? error.message : 'Unknown voice transport error.';
  return {
    errorMessage: rawMessage.replace(SECRET_PATTERN, '[redacted]').slice(0, 500),
    errorName: name,
  };
}

function waitForDataChannelOpen(channel: RTCDataChannel): Promise<void> {
  if (channel.readyState === 'open') return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('OpenAI voice connection timed out.'));
    }, CONNECTION_TIMEOUT_MS);

    const cleanup = (): void => {
      clearTimeout(timer);
      channel.removeEventListener('open', handleOpen);
      channel.removeEventListener('close', handleClose);
      channel.removeEventListener('error', handleError);
    };
    const handleOpen = (): void => {
      cleanup();
      resolve();
    };
    const handleClose = (): void => {
      cleanup();
      reject(new Error('OpenAI closed the voice connection.'));
    };
    const handleError = (): void => {
      cleanup();
      reject(new Error('OpenAI voice could not establish a media connection.'));
    };

    channel.addEventListener('open', handleOpen);
    channel.addEventListener('close', handleClose);
    channel.addEventListener('error', handleError);
  });
}

export function closeRealtimeVoiceTransport(
  transport: RealtimeVoiceTransport,
): void {
  transport.releasePlaceholderAudio?.();
  if (transport.channel.readyState !== 'closed') transport.channel.close();
  if (transport.connection.connectionState !== 'closed') {
    transport.connection.close();
  }
}

export function isRealtimeVoiceTransportReady(
  transport: RealtimeVoiceTransport | null,
): transport is RealtimeVoiceTransport {
  return Boolean(
    transport &&
      transport.channel.readyState === 'open' &&
      transport.connection.connectionState !== 'closed' &&
      transport.connection.connectionState !== 'failed',
  );
}

export async function openRealtimeVoiceTransport(
  {
    audioTrack,
    createPlaceholderAudio = createSilentPlaceholderAudio,
    createVoiceCall = (request) => window.tro.createVoiceCall(request),
    createPeerConnection = () => new RTCPeerConnection(),
    diagnosticLogger = logRealtimeVoiceDiagnostic,
  }: RealtimeVoiceTransportDependencies = {},
): Promise<RealtimeVoiceTransport> {
  const connection = createPeerConnection();
  const channel = connection.createDataChannel('oai-events');
  let placeholderAudio: RealtimeVoicePlaceholderAudio | null = null;
  let placeholderAudioReleased = false;
  let transport: RealtimeVoiceTransport | null = null;
  const releasePlaceholderAudio = (): void => {
    if (!placeholderAudio || placeholderAudioReleased) return;
    placeholderAudioReleased = true;
    placeholderAudio.release();
  };

  try {
    let sender: RTCRtpSender;
    if (audioTrack) {
      sender = connection.addTrack(audioTrack);
    } else {
      const createdPlaceholderAudio = createPlaceholderAudio();
      placeholderAudio = createdPlaceholderAudio;
      sender = connection.addTrack(
        createdPlaceholderAudio.track,
        createdPlaceholderAudio.stream,
      );
    }
    transport = {
      channel,
      connection,
      releasePlaceholderAudio: placeholderAudio
        ? releasePlaceholderAudio
        : undefined,
      sender,
    };
    diagnosticLogger('transport.create', {
      audioTrackAttached: Boolean(audioTrack),
      placeholderAudioAttached: Boolean(placeholderAudio),
    });

    const offer = await connection.createOffer();
    diagnosticLogger('transport.offer-created', {
      sdpLength: offer.sdp?.length ?? 0,
    });
    await connection.setLocalDescription(offer);
    diagnosticLogger('transport.local-description-set');
    diagnosticLogger('transport.call-start');
    const { answerSdp } = await createVoiceCall({
      offerSdp: offer.sdp ?? '',
    });
    diagnosticLogger('transport.call-response', {
      answerLength: answerSdp.length,
    });

    await connection.setRemoteDescription({
      type: 'answer',
      sdp: answerSdp,
    });
    diagnosticLogger('transport.remote-description-set');
    await waitForDataChannelOpen(channel);
    diagnosticLogger('transport.ready', {
      channelState: channel.readyState,
      connectionState: connection.connectionState,
    });
    return transport;
  } catch (error) {
    diagnosticLogger('transport.failed', {
      ...diagnosticErrorProperties(error),
      channelState: channel.readyState,
      connectionState: connection.connectionState,
    });
    if (transport) {
      closeRealtimeVoiceTransport(transport);
    } else {
      releasePlaceholderAudio();
      if (channel.readyState !== 'closed') channel.close();
      if (connection.connectionState !== 'closed') connection.close();
    }
    throw error;
  }
}
