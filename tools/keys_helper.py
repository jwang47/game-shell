"""Small Windows helper for test/visible.mjs.

    python keys_helper.py front TITLE      -> bring the window with TITLE to the front
    python keys_helper.py press VK [VK...] -> press keys together (down in order, up reversed)
    python keys_helper.py foreground       -> print the foreground window title
    python keys_helper.py sticky           -> print STICKYKEYS/TOGGLEKEYS/FILTERKEYS dwFlags as JSON
"""
import ctypes
import json
import sys
import time
from ctypes import wintypes

from latency_probe import bring_to_front, key, user32, window_title

EXTENDED = {0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, 0x5B, 0x5C}


class ACCESS(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.UINT), ("dwFlags", wintypes.DWORD), ("rest", wintypes.DWORD * 4)]


def flags(get, size):
    s = ACCESS(cbSize=size)
    user32.SystemParametersInfoW(get, size, ctypes.byref(s), 0)
    return s.dwFlags


def main():
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == "front":
        print(json.dumps(bring_to_front(args[0])))
    elif cmd == "press":
        vks = [int(v, 0) for v in args]
        for vk in vks:
            key(vk, extended=vk in EXTENDED)
            time.sleep(0.03)
        for vk in reversed(vks):
            key(vk, up=True, extended=vk in EXTENDED)
            time.sleep(0.03)
        print("null")
    elif cmd == "foreground":
        print(json.dumps(window_title(user32.GetForegroundWindow())))
    elif cmd == "sticky":
        print(json.dumps({"STICKYKEYS": flags(0x3A, 8), "TOGGLEKEYS": flags(0x34, 8), "FILTERKEYS": flags(0x32, 24)}))


if __name__ == "__main__":
    main()
