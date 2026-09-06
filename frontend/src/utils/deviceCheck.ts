export const VIRTUAL_SIGNATURES = [
  'obs', 'manycam', 'xsplit', 'virtual', 'ndi', 'iriun',
  'droidcam', 'epoccam', 'camo', 'reincubate', 'mmhmm',
  'snap camera', 'logitech capture', 'v4l2loopback', 'fake', 'software loopback'
]

export function isVirtualDeviceLabel(label: string = ''): boolean {
  const lower = label.toLowerCase()
  return VIRTUAL_SIGNATURES.some((sig) => lower.includes(sig))
}

export function checkActiveTrackForVirtual(track: MediaStreamTrack | null | undefined): { isVirtual: boolean; name: string } {
  if (!track) return { isVirtual: false, name: '' }
  const label = track.label || ''
  if (isVirtualDeviceLabel(label)) {
    return { isVirtual: true, name: label }
  }
  return { isVirtual: false, name: label }
}

export async function findPhysicalVideoDevices(): Promise<MediaDeviceInfo[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices.filter(
      (d) => d.kind === 'videoinput' && !isVirtualDeviceLabel(d.label)
    )
  } catch {
    return []
  }
}

export async function detectVirtualCamera(): Promise<{detected: boolean; deviceName?: string; action: 'BLOCK' | 'WARN' | 'PASS'}> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const videoDevices = devices.filter(d => d.kind === 'videoinput')

    const suspicious = videoDevices.filter(device =>
      isVirtualDeviceLabel(device.label)
    )

    if (suspicious.length > 0) {
      return { detected: true, deviceName: suspicious[0].label, action: 'BLOCK' }
    }

    // Secondary: check frameRate anomaly
    const stream = await navigator.mediaDevices.getUserMedia({ video: true })
    const track = stream.getVideoTracks()[0]
    const settings = track.getSettings()
    stream.getTracks().forEach(t => t.stop())

    if (checkActiveTrackForVirtual(track).isVirtual) {
      return { detected: true, deviceName: track.label, action: 'BLOCK' }
    }

    if (!settings.frameRate || settings.frameRate === 0 || settings.frameRate > 120) {
      return { detected: true, action: 'WARN' }
    }

    return { detected: false, action: 'PASS' }
  } catch (err) {
    console.error("Virtual camera detection failed to access media devices:", err)
    return { detected: false, action: 'PASS' }
  }
}
