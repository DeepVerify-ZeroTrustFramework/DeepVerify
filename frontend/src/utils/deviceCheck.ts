export async function detectVirtualCamera(): Promise<{detected: boolean; deviceName?: string; action: 'BLOCK' | 'WARN' | 'PASS'}> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const videoDevices = devices.filter(d => d.kind === 'videoinput')

    const VIRTUAL_SIGNATURES = [
      'obs', 'manycam', 'xsplit', 'virtual', 'ndi', 'iriun',
      'droidcam', 'epoccam', 'camo', 'reincubate', 'mmhmm',
      'snap camera', 'logitech capture'
    ]

    const suspicious = videoDevices.filter(device =>
      VIRTUAL_SIGNATURES.some(sig => device.label.toLowerCase().includes(sig))
    )

    if (suspicious.length > 0) {
      return { detected: true, deviceName: suspicious[0].label, action: 'BLOCK' }
    }

    // Secondary: check frameRate anomaly
    const stream = await navigator.mediaDevices.getUserMedia({ video: true })
    const track = stream.getVideoTracks()[0]
    const settings = track.getSettings()
    stream.getTracks().forEach(t => t.stop())

    if (!settings.frameRate || settings.frameRate === 0 || settings.frameRate > 120) {
      return { detected: true, action: 'WARN' }
    }

    return { detected: false, action: 'PASS' }
  } catch (err) {
    console.error("Virtual camera detection failed to access media devices:", err)
    return { detected: false, action: 'PASS' }
  }
}
