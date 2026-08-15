import type { VoiceSession } from '../shared/contracts';

const OPENAI_REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
const CONNECTION_TIMEOUT_MS = 12_000;

export interface RealtimeVoiceTransport {
  channel: RTCDataChannel;
  connection: RTCPeerConnection;
  sender: RTCRtpSender;
}

interface RealtimeVoiceTransportDependencies {
  createPeerConnection?: () => RTCPeerConnection;
  fetchImpl?: typeof fetch;
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
    createPeerConnection = () => new RTCPeerConnection(),
    fetchImpl = fetch,
  }: RealtimeVoiceTransportDependencies = {},
): Promise<RealtimeVoiceTransport> {
  const connection = createPeerConnection();
  const channel = connection.createDataChannel('oai-events');
  // Negotiate an audio sender without attaching a microphone track. A real
  // track is installed only while push-to-talk is actively held.
  const sender = connection.addTransceiver('audio', {
    direction: 'sendonly',
  }).sender;
  const transport = { channel, connection, sender };

  try {
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    const response = await fetchImpl(OPENAI_REALTIME_CALLS_URL, {
      method: 'POST',
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${session.clientSecret}`,
        'Content-Type': 'application/sdp',
      },
    });
    const answerSdp = await response.text();
    if (!response.ok) {
      throw new Error('OpenAI rejected the realtime voice connection.');
    }

    await connection.setRemoteDescription({
      type: 'answer',
      sdp: answerSdp,
    });
    await waitForDataChannelOpen(channel);
    return transport;
  } catch (error) {
    closeRealtimeVoiceTransport(transport);
    throw error;
  }
}
