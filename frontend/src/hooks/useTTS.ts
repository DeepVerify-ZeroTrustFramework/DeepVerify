import { useState, useEffect, useRef, useCallback } from 'react'

export interface TTSState {
  isMuted: boolean
  isSpeaking: boolean
  toggleMute: () => void
  speak: (text: string) => Promise<void>
  cancel: () => void
}

const DIRECT_SARVAM_KEY = import.meta.env.VITE_SARVAM_API_KEY || "sk_0l2l2gl8_XCCV2rvtlznZCfpFRsW9xAFl";

export function useTTS(sessionId: string): TTSState {
  const storageKey = `deepverify_tts_muted_${sessionId}`
  
  const [isMuted, setIsMuted] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(storageKey) === 'true'
    } catch {
      return false
    }
  })
  
  const [isSpeaking, setIsSpeaking] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null)

  // Cancel any active speech or pending network request
  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }

    if (audioRef.current) {
      try {
        audioRef.current.pause()
        audioRef.current.currentTime = 0
        audioRef.current.src = ''
      } catch (e) {
        console.warn('[useTTS] Error stopping audio element', e)
      }
      audioRef.current = null
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel()
      } catch (e) {
        console.warn('[useTTS] Error cancelling speechSynthesis', e)
      }
    }

    activeUtteranceRef.current = null
    setIsSpeaking(false)
  }, [])

  // Toggle mute state and persist for this session
  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      const next = !prev
      try {
        sessionStorage.setItem(storageKey, String(next))
      } catch (e) {
        console.warn('[useTTS] Failed to persist mute state', e)
      }
      if (next) {
        cancel()
      }
      return next
    })
  }, [storageKey, cancel])

  // Helper to play base64 audio string
  const playAudioBase64 = useCallback((b64: string, signal: AbortSignal): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        return resolve()
      }

      const audio = new Audio(`data:audio/wav;base64,${b64}`)
      audioRef.current = audio

      audio.onended = () => {
        setIsSpeaking(false)
        audioRef.current = null
        resolve()
      }

      audio.onerror = (e) => {
        setIsSpeaking(false)
        audioRef.current = null
        reject(e)
      }

      audio.onpause = () => {
        setIsSpeaking(false)
      }

      audio.play().catch(reject)
    })
  }, [])

  // Speak the given text via Backend TTS endpoint or Direct Sarvam API with browser SpeechSynthesis fallback
  const speak = useCallback(async (text: string) => {
    if (!text || !text.trim()) return

    // Immediately stop any in-progress speech
    cancel()

    // If muted, do not produce sound
    if (isMuted) return

    setIsSpeaking(true)
    const controller = new AbortController()
    abortControllerRef.current = controller

    let audioPlayed = false

    // Attempt 1: Via backend /api/tts proxy
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text.trim(),
          language_code: 'en-IN',
          speaker: 'ishita'
        }),
        signal: controller.signal
      })

      if (res.ok) {
        const data = await res.json()
        if (data.audios && Array.isArray(data.audios)) {
          for (const b64 of data.audios) {
            if (controller.signal.aborted) break;
            await playAudioBase64(b64, controller.signal)
          }
          audioPlayed = true
          return
        } else if (data.audio_base64) {
          await playAudioBase64(data.audio_base64, controller.signal)
          audioPlayed = true
          return
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return
      console.warn('[useTTS] Backend /api/tts call failed, attempting direct Sarvam API fallback', err)
    }

    if (audioPlayed || controller.signal.aborted) return

    // Attempt 2: Direct call to Sarvam AI API from frontend
    try {
      const directRes = await fetch('https://api.sarvam.ai/text-to-speech', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-subscription-key': DIRECT_SARVAM_KEY
        },
        body: JSON.stringify({
          text: text.trim(),
          language_code: 'en-IN',
          model: 'bulbul:v3',
          speaker: 'ishita'
        }),
        signal: controller.signal
      })

      if (directRes.ok) {
        const directData = await directRes.json()
        const audios = directData.audios
        if (audios && Array.isArray(audios) && audios.length > 0) {
          for (const b64 of audios) {
            if (controller.signal.aborted) break;
            await playAudioBase64(b64, controller.signal)
          }
          audioPlayed = true
          return
        }
      }
    } catch (directErr: any) {
      if (directErr.name === 'AbortError') return
      console.warn('[useTTS] Direct Sarvam API call failed, attempting browser Web Speech fallback', directErr)
    }

    if (audioPlayed || controller.signal.aborted) return

    // Attempt 3: Native Browser Web Speech API fallback
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel()
        const utterance = new SpeechSynthesisUtterance(text)
        utterance.lang = 'en-IN'
        utterance.rate = 1.0

        utterance.onend = () => {
          setIsSpeaking(false)
          activeUtteranceRef.current = null
        }

        utterance.onerror = () => {
          setIsSpeaking(false)
          activeUtteranceRef.current = null
        }

        activeUtteranceRef.current = utterance
        window.speechSynthesis.speak(utterance)
      } catch (synthErr) {
        console.error('[useTTS] Browser speech synthesis fallback failed', synthErr)
        setIsSpeaking(false)
      }
    } else {
      setIsSpeaking(false)
    }
  }, [isMuted, cancel, playAudioBase64])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancel()
    }
  }, [cancel])

  return {
    isMuted,
    isSpeaking,
    toggleMute,
    speak,
    cancel
  }
}
