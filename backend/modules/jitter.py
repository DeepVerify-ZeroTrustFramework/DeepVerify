"""
Network Jitter Analysis Module.

Detects deepfake-rendered video streams by analyzing RTP packet inter-arrival time (IAT)
distributions. Real camera feeds have consistent IAT; rendered streams show higher
coefficient of variation (CV) and positive skewness due to GPU rendering overhead.

Primary: Scapy RTP packet capture (requires CAP_NET_RAW)
Fallback: WebRTC stats API metrics (jitter, packetsLost, RTT from getStats())

Key metrics:
- Coefficient of Variation (CV) of IAT
- Skewness of IAT distribution
- RFC 3550 §6.4.1 running jitter estimate

Detection: CV > γ AND skewness > 0.5 → synthetic stream suspected
γ threshold: fiber=0.15, wifi=0.15, cellular=0.20 (set during Phase 0 network check)
"""
import numpy as np
from scipy import stats as sp_stats
from typing import Optional, List, Dict
import time
import asyncio


class JitterAnalyzer:
    """
    Stateful jitter analyzer that processes packet timing data and produces
    deepfake rendering detection metrics.

    Can operate in two modes:
    1. Packet-level: receives raw packet timestamps (from scapy or similar)
    2. Stats-level: receives WebRTC getStats() jitter values as fallback
    """

    def __init__(self, session_id: str, connection_type: str = "wifi"):
        self.session_id = session_id
        self.connection_type = connection_type

        # Set γ threshold per network type (from paper Table IV)
        self.gamma = {
            'fiber': 0.15,
            'wifi': 0.15,
            'cellular': 0.20,
        }.get(connection_type, 0.15)

        # Packet-level tracking
        self.iat_buffer: List[float] = []  # Inter-Arrival Times
        self.last_arrival: Optional[float] = None
        self.expected_iat: float = 1.0 / 10.0  # Expected ~100ms for 10fps frame streaming
        self.running_jitter: float = 0.0
        self.packet_count: int = 0

        # Stats-level fallback
        self.webrtc_jitter_buffer: List[float] = []

    def process_packet_timestamp(self, arrival_time: float):
        """
        Process a single packet arrival timestamp.

        Implements RFC 3550 §6.4.1 jitter formula:
        Ji = Ji-1 + (|d(i-1,i)| - Ji-1) / 16

        Args:
            arrival_time: Packet arrival time in seconds (monotonic clock)
        """
        self.packet_count += 1

        if self.last_arrival is not None:
            iat = arrival_time - self.last_arrival
            # Filter out gross pauses/reconnects (> 0.4s) to measure true streaming packet variance
            if 0.01 <= iat <= 0.40:
                self.iat_buffer.append(iat)

                # RFC 3550 running jitter estimate
                d = abs(iat - self.expected_iat)
                self.running_jitter += (d - self.running_jitter) / 16.0

        self.last_arrival = arrival_time

        # Keep buffer manageable
        if len(self.iat_buffer) > 500:
            self.iat_buffer = self.iat_buffer[-300:]

    def process_webrtc_stats(self, jitter: float, rtt: float = 0.0,
                             packets_lost: int = 0):
        """
        Fallback: process WebRTC getStats() jitter values when raw packet
        capture is not available.

        Args:
            jitter: Jitter value from RTCInboundRtpStreamStats (seconds)
            rtt: Round-trip time from RTCRemoteInboundRtpStreamStats (seconds)
            packets_lost: Packets lost count
        """
        self.webrtc_jitter_buffer.append(jitter)
        self.running_jitter = jitter

        # Synthesize IAT from jitter for CV computation
        # This is an approximation — real packet capture is more accurate
        if jitter > 0:
            # Jitter represents IAT variation; reconstruct approximate IAT
            base_iat = self.expected_iat
            simulated_iat = base_iat + np.random.normal(0, jitter)
            self.iat_buffer.append(max(0.001, simulated_iat))

        if len(self.webrtc_jitter_buffer) > 200:
            self.webrtc_jitter_buffer = self.webrtc_jitter_buffer[-100:]

    def compute_detection_metrics(self) -> Optional[Dict]:
        """
        Compute deepfake rendering detection metrics from accumulated IAT data.

        Returns None if insufficient data (< 30 packets).

        Returns:
            Dict with cv, skewness, running_jitter_ms, is_synthetic, confidence
        """
        if len(self.iat_buffer) < 15:
            return None

        # Use last 100 packets for analysis
        iats = np.array(self.iat_buffer[-100:])

        mean_iat = np.mean(iats)
        std_iat = np.std(iats)

        # Coefficient of Variation
        raw_cv = std_iat / (mean_iat + 1e-10)
        cv = 0.0 if (np.isnan(raw_cv) or np.isinf(raw_cv)) else float(raw_cv)

        # Skewness — positive skew indicates rendering overhead (occasional long delays)
        raw_skew = float(sp_stats.skew(iats))
        skewness = 0.0 if (np.isnan(raw_skew) or np.isinf(raw_skew)) else raw_skew

        # Detection decision
        is_synthetic = (cv > self.gamma) and (skewness > 0.5)

        # Confidence: how far past the threshold
        confidence = min(1.0, cv / (2 * self.gamma)) if is_synthetic else max(0.0, cv / self.gamma)

        return {
            'cv': round(float(cv), 4),
            'skewness': round(float(skewness), 4),
            'running_jitter_ms': round(float(self.running_jitter * 1000), 2),
            'is_synthetic': bool(is_synthetic),
            'confidence': round(float(confidence), 3),
            'packets_analyzed': len(iats),
            'gamma_threshold': self.gamma,
            'connection_type': self.connection_type,
        }


# --- Scapy packet capture (optional, requires CAP_NET_RAW) ---

_scapy_available = False
try:
    from scapy.all import sniff, RTP, UDP, IP
    _scapy_available = True
except ImportError:
    pass


async def start_packet_capture(analyzer: JitterAnalyzer, interface: str = "any",
                                port: int = 0, duration: float = 0):
    """
    Start passive RTP packet capture using scapy.

    This runs in a separate thread to avoid blocking the async event loop.
    Falls back gracefully if scapy is not available or raw sockets are denied.

    Args:
        analyzer: JitterAnalyzer instance to feed packets into
        interface: Network interface to sniff on
        port: RTP port to filter (0 = auto-detect)
        duration: Duration in seconds (0 = indefinite)
    """
    if not _scapy_available:
        print(f"[Jitter] Scapy not available for session {analyzer.session_id}. "
              f"Using WebRTC stats fallback.")
        return

    def packet_handler(pkt):
        if pkt.haslayer(UDP):
            analyzer.process_packet_timestamp(pkt.time)

    try:
        bpf_filter = f"udp port {port}" if port > 0 else "udp"
        # Run sniff in executor to avoid blocking
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            lambda: sniff(
                iface=interface,
                filter=bpf_filter,
                prn=packet_handler,
                timeout=duration if duration > 0 else None,
                store=False,
            )
        )
    except PermissionError:
        print(f"[Jitter] Permission denied for packet capture. "
              f"Using WebRTC stats fallback for session {analyzer.session_id}.")
    except Exception as e:
        print(f"[Jitter] Packet capture error: {e}. Using WebRTC stats fallback.")
