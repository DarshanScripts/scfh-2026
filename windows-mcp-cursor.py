"""Customize pointer movement and the control indicator in Windows-MCP 0.8.9."""

from math import ceil, hypot
from time import perf_counter, sleep

from windows_mcp import uia
from windows_mcp.desktop import control_overlay, service
from windows_mcp.desktop.control import get_controller
from windows_mcp.__main__ import main


def travel_time(start, target):
    distance = hypot(target[0] - start[0], target[1] - start[1])
    return 0 if distance < 5 else min(1.15, 0.32 + distance / 1400)


class SmoothDesktop(service.Desktop):
    def move(self, loc):
        x, y = loc
        self._validate_screen_point(x, y)
        owner = get_controller()
        owner.checkpoint_current()
        start = uia.GetCursorPos()
        if tuple(start) == (x, y):
            return

        duration = travel_time(start, loc)
        frames = max(1, ceil(duration * 60))
        started = perf_counter()
        for frame in range(1, frames + 1):
            t = frame / frames
            sleep(max(0, started + t * duration - perf_counter()))
            owner.checkpoint_current()
            progress = t ** 3 * (10 + t * (-15 + 6 * t))
            uia.SetCursorPos(
                round(start[0] + (x - start[0]) * progress),
                round(start[1] + (y - start[1]) * progress),
            )
            owner.record_step_current()

    def click(self, loc, button="left", clicks=1):
        self.move(loc)
        return super().click(loc, button=button, clicks=clicks)

    def type(self, loc, text, caret_position="idle", clear=False, press_enter=False):
        self.move(loc)
        return super().type(
            loc, text, caret_position=caret_position, clear=clear, press_enter=press_enter
        )

    def drag(self, loc, from_loc=None, duration=None):
        # Keep the driver's button hold and release logic for the drag itself.
        if from_loc is not None:
            self._validate_screen_point(*loc)
            self._normalize_drag_duration(duration)
            self.move(from_loc)
        if duration is None:
            duration = travel_time(uia.GetCursorPos(), loc)
        return super().drag(loc, from_loc=from_loc, duration=duration)


if __name__ == "__main__":
    # The pinned CLI imports Desktop when it initializes its runtime.
    service.Desktop = SmoothDesktop
    # The pinned renderer treats a missing notice bitmap as border and cursor only.
    # Leave the control overlay lifecycle and physical takeover intact.
    control_overlay._notice_bitmap = lambda _width: None
    main()
