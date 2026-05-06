/**
 * Sonos Routes — local SOAP control for Sonos speakers.
 */
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

interface SonosPlayBody {
    audioUrl?: string;
    sonosIp?: string;
    title?: string;
    artist?: string;
}

interface SonosControlBody {
    sonosIp?: string;
    action?: 'play' | 'pause' | 'stop' | 'seek' | 'volume';
    positionSeconds?: number;
    volume?: number;
}

class SonosSoapError extends Error {
    constructor(
        message: string,
        readonly action: string,
        readonly status: number,
        readonly responseText: string
    ) {
        super(message);
        this.name = 'SonosSoapError';
    }

    get upnpCode(): string | null {
        return this.responseText.match(/<errorCode>([^<]+)<\/errorCode>/)?.[1] ?? null;
    }

    get upnpDescription(): string | null {
        return this.responseText.match(/<errorDescription>([^<]+)<\/errorDescription>/)?.[1] ?? null;
    }
}

function isPrivateIPv4(ip: string): boolean {
    const parts = ip.split('.').map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
        return false;
    }

    const [a, b] = parts;
    return (
        a === 10 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 169 && b === 254)
    );
}

function assertValidAudioUrl(audioUrl: string): URL {
    const url = new URL(audioUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Audio URL must use http or https');
    }
    return url;
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function createSoapEnvelope(action: string, innerXml: string, service = 'AVTransport'): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:${action} xmlns:u="urn:schemas-upnp-org:service:${service}:1">
      ${innerXml}
    </u:${action}>
  </s:Body>
</s:Envelope>`;
}

function createDidlMetadata(options: {
    uri: string;
    title?: string;
    artist?: string;
    protocolInfo: string;
    upnpClass: 'object.item.audioItem.musicTrack' | 'object.item.audioItem.audioBroadcast';
}): string {
    const title = escapeXml(options.title?.trim() || 'ARCOD')
    const artist = escapeXml(options.artist?.trim() || 'ARCOD')
    const uri = escapeXml(options.uri)
    const protocolInfo = escapeXml(options.protocolInfo)

    return `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">
  <item id="arcod:track" parentID="0" restricted="true">
    <dc:title>${title}</dc:title>
    <dc:creator>${artist}</dc:creator>
    <upnp:class>${options.upnpClass}</upnp:class>
    <res protocolInfo="${protocolInfo}">${uri}</res>
  </item>
</DIDL-Lite>`;
}

function createSetUriEnvelope(uri: string, metadata: string): string {
    return createSoapEnvelope(
        'SetAVTransportURI',
        `<InstanceID>0</InstanceID>
      <CurrentURI>${escapeXml(uri)}</CurrentURI>
      <CurrentURIMetaData>${escapeXml(metadata)}</CurrentURIMetaData>`
    );
}

function createRadioUri(audioUrl: string): string {
    return `x-rincon-mp3radio://${audioUrl.replace(/^https?:\/\//, '')}`;
}

function formatRelTime(seconds: number): string {
    const safeSeconds = Math.max(0, Math.floor(seconds || 0));
    const h = Math.floor(safeSeconds / 3600);
    const m = Math.floor((safeSeconds % 3600) / 60);
    const s = safeSeconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function validateSonosIp(sonosIp: string | undefined, reply: FastifyReply): sonosIp is string {
    if (!sonosIp?.trim()) {
        reply.code(400).send({ error: 'sonosIp is required' });
        return false;
    }

    if (!isPrivateIPv4(sonosIp.trim())) {
        reply.code(400).send({ error: 'sonosIp must be a private local IPv4 address' });
        return false;
    }

    return true;
}

async function sendSonosSoap(controlUrl: string, service: 'AVTransport' | 'RenderingControl', action: string, body: string): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);

    try {
        const response = await fetch(controlUrl, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'text/xml; charset="utf-8"',
                SOAPAction: `"urn:schemas-upnp-org:service:${service}:1#${action}"`,
            },
            body,
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new SonosSoapError(
                `Sonos ${action} failed with status ${response.status}${text ? `: ${text.slice(0, 1000)}` : ''}`,
                action,
                response.status,
                text
            );
        }
    } finally {
        clearTimeout(timeout);
    }
}

async function handleSonosPlay(req: FastifyRequest<{ Body: SonosPlayBody }>, reply: FastifyReply) {
    const audioUrl = req.body?.audioUrl?.trim();
    const sonosIp = req.body?.sonosIp?.trim();
    const title = req.body?.title?.trim();
    const artist = req.body?.artist?.trim();

    if (!audioUrl || !sonosIp) {
        return reply.code(400).send({ error: 'audioUrl and sonosIp are required' });
    }

    try {
        assertValidAudioUrl(audioUrl);
    } catch {
        return reply.code(400).send({ error: 'audioUrl must be a valid http(s) URL' });
    }

    if (!validateSonosIp(sonosIp, reply)) return;

    const controlUrl = `http://${sonosIp.trim()}:1400/MediaRenderer/AVTransport/Control`;
    const directMetadata = createDidlMetadata({
        uri: audioUrl,
        title,
        artist,
        protocolInfo: 'http-get:*:audio/mpeg:*',
        upnpClass: 'object.item.audioItem.musicTrack',
    });
    const directSetUriEnvelope = createSetUriEnvelope(audioUrl, directMetadata);

    const radioUri = createRadioUri(audioUrl);
    const radioMetadata = createDidlMetadata({
        uri: radioUri,
        title,
        artist,
        protocolInfo: 'sonos.com-http:*:audio/mpeg:*',
        upnpClass: 'object.item.audioItem.audioBroadcast',
    });
    const radioSetUriEnvelope = createSetUriEnvelope(radioUri, radioMetadata);

    const playEnvelope = createSoapEnvelope(
        'Play',
        `<InstanceID>0</InstanceID>
      <Speed>1</Speed>`
    );

    try {
        try {
            await sendSonosSoap(controlUrl, 'AVTransport', 'SetAVTransportURI', directSetUriEnvelope);
        } catch (error: any) {
            const upnpCode = error instanceof SonosSoapError ? error.upnpCode : null;
            req.log.warn({ err: error, upnpCode }, '[Sonos] Direct URI failed, trying x-rincon-mp3radio fallback');
            await sendSonosSoap(controlUrl, 'AVTransport', 'SetAVTransportURI', radioSetUriEnvelope);
        }
        await sendSonosSoap(controlUrl, 'AVTransport', 'Play', playEnvelope);
        return reply.send({ success: true, mode: 'sonos' });
    } catch (error: any) {
        req.log.error(error, '[Sonos] Failed to start playback');
        const upnpCode = error instanceof SonosSoapError ? error.upnpCode : null;
        const upnpDescription = error instanceof SonosSoapError ? error.upnpDescription : null;
        return reply.code(502).send({
            error: 'Failed to send command to Sonos',
            message: error?.name === 'AbortError' ? 'Sonos request timed out' : error?.message,
            upnpCode,
            upnpDescription,
        });
    }
}

async function handleSonosControl(req: FastifyRequest<{ Body: SonosControlBody }>, reply: FastifyReply) {
    const sonosIp = req.body?.sonosIp?.trim();
    const action = req.body?.action;

    if (!validateSonosIp(sonosIp, reply)) return;
    if (!action) return reply.code(400).send({ error: 'action is required' });

    const avTransportUrl = `http://${sonosIp.trim()}:1400/MediaRenderer/AVTransport/Control`;
    const renderingUrl = `http://${sonosIp.trim()}:1400/MediaRenderer/RenderingControl/Control`;

    try {
        if (action === 'play') {
            await sendSonosSoap(
                avTransportUrl,
                'AVTransport',
                'Play',
                createSoapEnvelope('Play', '<InstanceID>0</InstanceID><Speed>1</Speed>')
            );
        } else if (action === 'pause') {
            await sendSonosSoap(
                avTransportUrl,
                'AVTransport',
                'Pause',
                createSoapEnvelope('Pause', '<InstanceID>0</InstanceID>')
            );
        } else if (action === 'stop') {
            await sendSonosSoap(
                avTransportUrl,
                'AVTransport',
                'Stop',
                createSoapEnvelope('Stop', '<InstanceID>0</InstanceID>')
            );
        } else if (action === 'seek') {
            await sendSonosSoap(
                avTransportUrl,
                'AVTransport',
                'Seek',
                createSoapEnvelope('Seek', `<InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>${formatRelTime(req.body?.positionSeconds || 0)}</Target>`)
            );
        } else if (action === 'volume') {
            const volume = Math.max(0, Math.min(100, Math.round(req.body?.volume || 0)));
            await sendSonosSoap(
                renderingUrl,
                'RenderingControl',
                'SetVolume',
                createSoapEnvelope('SetVolume', `<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>${volume}</DesiredVolume>`, 'RenderingControl')
            );
        } else {
            return reply.code(400).send({ error: 'Unsupported Sonos action' });
        }

        return reply.send({ success: true });
    } catch (error: any) {
        req.log.error(error, '[Sonos] Control command failed');
        const upnpCode = error instanceof SonosSoapError ? error.upnpCode : null;
        const upnpDescription = error instanceof SonosSoapError ? error.upnpDescription : null;
        return reply.code(502).send({
            error: 'Failed to send command to Sonos',
            message: error?.name === 'AbortError' ? 'Sonos request timed out' : error?.message,
            upnpCode,
            upnpDescription,
        });
    }
}

export async function sonosRoutes(fastify: FastifyInstance) {
    fastify.post('/v2/sonos/play', handleSonosPlay);
    fastify.post('/v2/sonos/control', handleSonosControl);
    fastify.post('/api/sonos/play', handleSonosPlay);
    fastify.post('/api/sonos/control', handleSonosControl);
}
