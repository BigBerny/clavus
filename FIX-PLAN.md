# Fix: Sending from HomeScreen doesn't create new conversation

## Bug
When user is on HomeScreen and sends a message via InputBar, it should create a new thread. Instead, the message gets appended to the last/existing conversation.

## Root Cause Analysis

The `handleSend` callback in `App.tsx` checks `visiblePanel === 'home'` to decide whether to create a new thread or send to the existing one:

```tsx
const handleSend = useCallback((text: string, images?: string[]) => {
  if (visiblePanel === 'home') {
    // Create new thread + send
  } else {
    // Send to existing visiblePanel thread
    switchThread(visiblePanel)
    loadThread(visiblePanel)
    send(text, images)
  }
}, [visiblePanel, send, switchThread, loadThread])
```

**The problem:** `visiblePanel` is updated by a scroll handler with a **200ms debounce** and a **snap-position guard** (`Math.abs(scrollLeft - snappedPosition) > 5`). Two failure modes:

1. **Snap guard bail-out:** If the debounced handler fires while the CSS scroll-snap animation is still settling (not within 5px of a panel boundary), it returns early without updating `visiblePanel`. No further scroll events fire after the animation completes, so `visiblePanel` is never updated. The user sees the home screen but `visiblePanel` still holds the previous thread ID.

2. **DOM shift after thread creation:** When a new thread is created, `sortedThreads` adds a new panel to the left of home. This shifts scroll positions. The scroll-snap container may fire scroll events that cause `visiblePanel` to briefly point at the wrong panel.

Both result in `visiblePanel !== 'home'` when the user is actually looking at the home screen, so the `else` branch runs and the message goes to the old thread.

## Proposed Fix

### Option A: Check actual scroll position at send time (recommended)

Instead of relying on `visiblePanel` React state (which can be stale), check the real scroll position at the moment of sending:

**File: `App.tsx`**

Add a helper that checks if home panel is currently visible:

```tsx
const isHomeVisible = useCallback(() => {
  const container = scrollContainerRef.current
  if (!container) return visiblePanel === 'home' // fallback
  const containerWidth = container.clientWidth
  if (!containerWidth) return visiblePanel === 'home'
  const panelIndex = Math.round(container.scrollLeft / containerWidth)
  return panelIndex >= sortedThreads.length
}, [sortedThreads, visiblePanel])
```

Then use it in `handleSend`:

```tsx
const handleSend = useCallback((text: string, images?: string[]) => {
  if (isHomeVisible()) {
    // Create new thread...
  } else {
    // Send to current thread...
  }
}, [isHomeVisible, send, switchThread, loadThread, visiblePanel])
```

This bypasses the stale `visiblePanel` state entirely.

### Option B: Also fix the scroll handler (belt-and-suspenders)

The scroll handler's snap guard can prevent `visiblePanel` from ever updating. Fix by adding a fallback check:

```tsx
const handleScroll = () => {
  if (isProgrammaticScroll.current) return
  if (scrollTimeout) clearTimeout(scrollTimeout)
  scrollTimeout = setTimeout(() => {
    const containerWidth = container.clientWidth
    if (!containerWidth) return
    const scrollLeft = container.scrollLeft
    const panelIndex = Math.round(scrollLeft / containerWidth)
    
    // REMOVED: snap guard that was too strict
    // The Math.round already handles snap proximity well enough
    
    if (panelIndex >= sortedThreads.length) {
      setVisiblePanel('home')
    } else {
      const thread = sortedThreads[panelIndex]
      if (thread) setVisiblePanel(thread.id)
    }
  }, 150) // Slightly shorter debounce
}
```

Changes:
- Remove the `Math.abs(scrollLeft - snappedPosition) > 5` guard entirely. `Math.round` already gives the nearest panel.
- Remove the `visiblePanel !== 'home'` / `visiblePanel !== thread.id` conditionals. Just always set it (React deduplicates if value is same).
- Reduce debounce from 200ms to 150ms for snappier detection.

### Option C: Fix stale `isHome` prop on InputBar

`App.tsx:447` passes `isHome={visiblePanel === 'home'}` to `InputBar`. This suffers from the same stale-state issue — InputBar may show thread-mode styling/placeholder while the user is actually on home. Use the same `isHomeVisible()` helper:

```tsx
<InputBar
  ...
  isHome={isHomeVisible()}
/>
```

Or, if `isHomeVisible` is only recalculated on render (since it reads the DOM), consider making `isHome` derived from a ref-based check inside InputBar's send handler instead.

### Additional Bug: Redundant `switchThread` in createThread path

In `handleSend` (line 311-315), `createThread()` already sets `activeThreadId` to the new thread ID internally (threads.ts:245-246). The subsequent `switchThread(newThreadId)` on line 314 is redundant. Not harmful, but worth cleaning up for clarity.

### Additional Bug: `saveMessages` targets wrong thread if `activeThreadId` lags

`chat.ts:saveMessages()` (line 38) reads `useThreadsStore.getState().activeThreadId` to decide *which thread* to save to. This is called from `addMessage` (line 59). In the new-thread flow, `createThread()` sets `activeThreadId` synchronously via Zustand, so this works. **However**, if any code path ever calls `send()` before `switchThread/createThread` completes, messages would be saved to the wrong thread. This coupling is fragile — the thread ID should ideally be passed explicitly rather than read from global state. Not a bug today, but a latent risk.

## Edge Cases

1. **Quick double-send from home:** After first send, `visiblePanel` is set to `newThreadId`. If user hits send again before scroll handler fires, Option A's `isHomeVisible()` would return false (scroll already moved to new panel). This is correct behavior.

2. **Send during snap animation:** Option A checks actual scroll position, so even mid-animation it would detect the closest panel. If the user is between panels, `Math.round` picks the nearest one.

3. **Empty threads filtered out:** `sortedThreads` filters threads with 0 messages. A newly created thread (with the just-sent message) will appear in `sortedThreads` on next render. The panel index calculation accounts for this since we check `>= sortedThreads.length`.

4. **Voice input auto-send:** Voice transcription calls `onSend` directly, which triggers `handleSend`. Same fix applies.

## Implementation Order

1. Apply Option A (isHomeVisible helper) — fixes the bug
2. Apply Option B (scroll handler cleanup) — prevents stale visiblePanel in general
3. Test: load app, be on home, type message, send → should create new thread
4. Test: open thread, swipe back to home, send → should create new thread
5. Test: send from existing thread → should append to that thread
6. Test: swipe to home quickly and send within <200ms → should create new thread (the main bug scenario)
7. Test: InputBar placeholder/styling reflects "home" mode when on home screen
