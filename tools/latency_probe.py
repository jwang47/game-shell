"""End-to-end key-to-photon probe (software).

Presses a real key through SendInput and watches the screen with DXGI desktop
duplication until the scene's corner square flips between black and white.
The time between the two is what a player feels, minus the display's own
scan-out and pixel response (the same for every arm).

    python latency_probe.py --title "Latency scene" --presses 200

Prints one JSON object with the samples in milliseconds.
"""
import argparse
import ctypes
import json
import random
import sys
import time
from ctypes import wintypes

import dxcam

user32 = ctypes.WinDLL("user32", use_last_error=True)

VK_RIGHT = 0x27
VK_MENU = 0x12
KEYEVENTF_EXTENDEDKEY = 0x1
KEYEVENTF_KEYUP = 0x2
INPUT_KEYBOARD = 1


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD),
                ("time", wintypes.DWORD), ("dwExtraInfo", ctypes.c_size_t)]


class INPUT(ctypes.Structure):
    class _U(ctypes.Union):
        _fields_ = [("ki", KEYBDINPUT), ("pad", ctypes.c_byte * 32)]
    _anonymous_ = ("u",)
    _fields_ = [("type", wintypes.DWORD), ("u", _U)]


def key(vk, up=False, extended=True):
    flags = (KEYEVENTF_EXTENDEDKEY if extended else 0) | (KEYEVENTF_KEYUP if up else 0)
    inp = INPUT(type=INPUT_KEYBOARD, ki=KEYBDINPUT(wVk=vk, dwFlags=flags))
    if user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT)) != 1:
        raise OSError(ctypes.get_last_error(), "SendInput failed")


def window_title(hwnd):
    buf = ctypes.create_unicode_buffer(512)
    user32.GetWindowTextW(hwnd, buf, 512)
    return buf.value


def find_window(part):
    found = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def each(hwnd, _):
        if user32.IsWindowVisible(hwnd) and part in window_title(hwnd):
            found.append(hwnd)
        return True

    user32.EnumWindows(each, 0)
    return found[0] if found else None


def bring_to_front(part):
    """Make the bench window the foreground window. Windows lets a process
    take the foreground right after it handled input, so tap Alt first."""
    for _ in range(20):
        hwnd = find_window(part)
        if hwnd and part in window_title(user32.GetForegroundWindow()):
            return True
        if hwnd:
            key(VK_MENU, extended=False)
            key(VK_MENU, up=True, extended=False)
            user32.SetForegroundWindow(hwnd)
        time.sleep(0.25)
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--title", default="Latency scene")
    ap.add_argument("--presses", type=int, default=200)
    ap.add_argument("--region", default="8,8,40,40", help="left,top,right,bottom in screen pixels")
    ap.add_argument("--timeout-ms", type=float, default=250)
    ap.add_argument("--keys-only", type=float, default=0, metavar="SECONDS",
                    help="only press keys for this long; no screen capture")
    a = ap.parse_args()

    if not bring_to_front(a.title):
        print(json.dumps({"error": f"could not bring '{a.title}' to the front"}))
        return 1
    if a.keys_only:
        # No screen capture (it can stop G-SYNC and independent flip): just
        # press keys for PresentMon's input-to-photon tracking.
        presses, lost_focus = 0, 0
        end = time.perf_counter() + a.keys_only
        while time.perf_counter() < end:
            if a.title not in window_title(user32.GetForegroundWindow()):
                lost_focus += 1
                if not bring_to_front(a.title):
                    break
            key(VK_RIGHT)
            time.sleep(0.03)
            key(VK_RIGHT, up=True)
            presses += 1
            time.sleep(random.uniform(0.06, 0.12))
        print(json.dumps({"presses": presses, "lost_focus": lost_focus}))
        return 0

    region = tuple(int(v) for v in a.region.split(","))
    cam = dxcam.create(output_idx=0, output_color="GRAY")

    def level():
        # grab() returns None when the desktop has not changed since the last call.
        frame = None
        while frame is None:
            frame = cam.grab(region=region)
        return float(frame.mean())

    samples, misses, lost_focus = [], 0, 0
    current = level()
    for _ in range(a.presses):
        if a.title not in window_title(user32.GetForegroundWindow()):
            lost_focus += 1
            if not bring_to_front(a.title):
                break
            current = level()
        want_white = current < 128
        t0 = time.perf_counter()
        key(VK_RIGHT)
        seen = None
        while (time.perf_counter() - t0) * 1000 < a.timeout_ms:
            frame = cam.grab(region=region)
            if frame is None:
                continue
            value = float(frame.mean())
            if (value > 192) if want_white else (value < 64):
                seen = time.perf_counter()
                current = value
                break
        key(VK_RIGHT, up=True)
        if seen is None:
            misses += 1
            current = level()
        else:
            samples.append((seen - t0) * 1000)
        # Random gap so presses land at every point of the refresh cycle.
        time.sleep(random.uniform(0.06, 0.12))

    del cam
    print(json.dumps({"samples": samples, "misses": misses, "lost_focus": lost_focus}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
