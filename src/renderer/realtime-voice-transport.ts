import type { VoiceSession } from '../shared/contracts';

const OPENAI_REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
const CONNECTION_TIMEOUT_MS = 12_000;

export interface RealtimeVoiceTransport {
  channel: RTCDataChannel;
  connection: RTCPeerConnection;
  sender: RTCRtpSender;
}

export interface OutboundAudioStats {
  bytesSent: number;
  packetsSent: number;
}

export interface RealtimeVoiceTransportDependencies {
  audioTrack?: MediaStreamTrack;
  createPeerConnection?: () => RTCPeerConnection;
  diagnosticLogger?: VoiceDiagnosticLogger;
  fetchImpl?: typeof fetch;
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
    const outbound = stats as RTCOutboundRtpStreamStats;
    if (outbound.kind !== 'audio') return;
    totals.bytesSent += outbound.bytesSent ?? 0;
    totals.packetsSent += outbound.packetsSent ?? 0;
  });

  return totals;
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
  session: VoiceSession,
  {
    audioTrack,
    createPeerConnection = () => new RTCPeerConnection(),
    diagnosticLogger = logRealtimeVoiceDiagnostic,
    fetchImpl = fetch,
  }: RealtimeVoiceTransportDependencies = {},
): Promise<RealtimeVoiceTransport> {
  const connection = createPeerConnection();
  const channel = connection.createDataChannel('oai-events');
  const sender = audioTrack
    ? connection.addTrack(audioTrack)
    : connection.addTransceiver('audio', { direction: 'sendonly' }).sender;
  const transport = { channel, connection, sender };
  diagnosticLogger('transport.create', {
    audioTrackAttached: Boolean(audioTrack),
    expiresAt: session.expiresAt,
    model: session.model,
  });

  try {
    const offer = await connection.createOffer();
    diagnosticLogger('transport.offer-created', {
      sdpLength: offer.sdp?.length ?? 0,
    });
    await connection.setLocalDescription(offer);
    diagnosticLogger('transport.local-description-set');
    diagnosticLogger('transport.call-start');
    const response = await fetchImpl(OPENAI_REALTIME_CALLS_URL, {
      method: 'POST',
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${session.clientSecret}`,
        'Content-Type': 'application/sdp',
      },
    });
    const answerSdp = await response.text();
    diagnosticLogger('transport.call-response', {
      answerLength: answerSdp.length,
      ok: response.ok,
      status: response.status,
    });
    if (!response.ok) {
      throw new Error('OpenAI rejected the realtime voice connection.');
    }

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
    closeRealtimeVoiceTransport(transport);
    throw error;
  }
}
