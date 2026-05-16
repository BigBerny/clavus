/**
 * Correction suggestion popup for the CodeMirror source editor.
 * Mirrors the Tiptap CorrectionPopup but reads from CodeMirror state.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { EditorView } from "@codemirror/view"
import {
  cmTypewiseState,
  removeCorrection,
  setActiveCorrection,
} from "../extensions/codemirror-typewise"
import { addToDictionary, type CorrectionEntry } from "../extensions/typewise-api"

import { Card, CardBody } from "@/components/tiptap-ui-primitive/card"
import { Button, ButtonGroup } from "@/components/tiptap-ui-primitive/button"
import { Separator } from "@/components/tiptap-ui-primitive/separator"
import { Badge } from "@/components/tiptap-ui-primitive/badge"
import { Label } from "@/components/tiptap-ui-primitive/label"

const MAX_AUTO_SUGGESTIONS = 5
const MAX_MANUAL_SUGGESTIONS = 4

const IconThumbUp = () => (
  <svg className="tiptap-button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 11v8a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1v-7a1 1 0 0 1 1 -1h3a4 4 0 0 0 4 -4v-1a2 2 0 0 1 4 0v5h3a2 2 0 0 1 2 2l-1 5a2 3 0 0 1 -2 2h-7a3 3 0 0 1 -3 -3" />
  </svg>
)
const IconArrowBackUp = () => (
  <svg className="tiptap-button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 14l-4 -4l4 -4" /><path d="M5 10h11a4 4 0 1 1 0 8h-1" />
  </svg>
)
const IconBook = () => (
  <svg className="tiptap-button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0" /><path d="M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0" />
    <path d="M3 6l0 13" /><path d="M12 6l0 13" /><path d="M21 6l0 13" />
  </svg>
)
const IconReturn = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18l-6 -6l6 -6" /><path d="M3 12h16v-7" />
  </svg>
)

type MenuAction = "accept" | "revert" | "suggestion" | "neverCorrect"
interface MenuItem { action: MenuAction; label: React.ReactNode; value: string; icon?: React.ReactNode; shortcut?: number; isHighlighted?: boolean; title?: string }
interface DividerItem { action: "divider" }
type PopupItem = MenuItem | DividerItem
function isDivider(item: PopupItem): item is DividerItem { return item.action === "divider" }

interface SourceCorrectionPopupProps {
  editorView: EditorView | null
}

export function SourceCorrectionPopup({ editorView }: SourceCorrectionPopupProps) {
  const [activeCorrection, setActiveCorrectionState] = useState<CorrectionEntry | null>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const popupRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!editorView) return

    const checkState = () => {
      try {
        const twState = editorView.state.field(cmTypewiseState)
        const corr = twState.activeCorrection
        setActiveCorrectionState(corr)

        if (corr) {
          const el = editorView.dom.querySelector(`[data-tw-correction-id="${corr.id}"]`)
          if (el) {
            const rect = el.getBoundingClientRect()
            setPosition({ top: rect.bottom + 4, left: rect.left })
          } else {
            const coords = editorView.coordsAtPos(corr.from)
            if (coords) {
              setPosition({ top: coords.bottom + 4, left: coords.left })
            } else {
              setPosition(null)
            }
          }
        } else {
          setPosition(null)
        }
      } catch { /* field may not exist */ }
    }

    const interval = setInterval(checkState, 100)
    return () => clearInterval(interval)
  }, [editorView])

  useEffect(() => {
    if (!activeCorrection || !editorView) return

    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        editorView.dispatch({ effects: setActiveCorrection.of(null) })
      }
    }

    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside)
    }, 50)
    return () => {
      clearTimeout(timer)
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [activeCorrection, editorView])

  const buildMenuItems = useCallback((corr: CorrectionEntry): PopupItem[] => {
    if (corr.type === "auto") {
      const items: PopupItem[] = [
        { action: "accept", label: corr.currentValue, value: corr.currentValue, icon: <IconThumbUp />, isHighlighted: true },
        { action: "revert", label: <>Revert to &quot;<em>{corr.originalValue}</em>&quot;</>, value: corr.originalValue, icon: <IconArrowBackUp /> },
        { action: "neverCorrect", label: <>Never correct &quot;<em>{corr.originalValue}</em>&quot;</>, value: corr.originalValue, icon: <IconBook /> },
      ]
      const alternatives = corr.suggestions.slice(0, MAX_AUTO_SUGGESTIONS).filter(s => s.correction !== corr.currentValue && s.correction !== corr.originalValue)
      if (alternatives.length > 0) {
        items.push({ action: "divider" })
        alternatives.forEach((s, i) => { items.push({ action: "suggestion", label: s.correction, value: s.correction, shortcut: i + 1 }) })
      }
      return items
    } else {
      const items: PopupItem[] = []
      const suggestions = corr.suggestions.slice(0, MAX_MANUAL_SUGGESTIONS).filter(s => s.correction !== corr.originalValue)
      suggestions.forEach((s, i) => { items.push({ action: "suggestion", label: s.correction, value: s.correction, shortcut: i + 1, title: i === 0 ? "Recommended spelling" : undefined }) })
      if (suggestions.length > 0) items.push({ action: "divider" })
      items.push({ action: "accept", label: corr.originalValue, value: corr.originalValue, icon: <IconThumbUp />, isHighlighted: suggestions.length === 0 })
      items.push({ action: "neverCorrect", label: <>Never correct &quot;<em>{corr.originalValue}</em>&quot;</>, value: corr.originalValue, icon: <IconBook /> })
      return items
    }
  }, [])

  const applyItem = useCallback((item: MenuItem) => {
    if (!activeCorrection || !editorView) return

    const twState = editorView.state.field(cmTypewiseState)
    const corr = twState.corrections.find(c => c.id === activeCorrection.id) ?? activeCorrection

    if (item.action === "neverCorrect") {
      addToDictionary(item.value)
      if (corr.type === "auto") {
        editorView.dispatch({
          changes: { from: corr.from, to: corr.to, insert: corr.originalValue },
          effects: removeCorrection.of(corr.id),
        })
      } else {
        editorView.dispatch({ effects: removeCorrection.of(corr.id) })
      }
      editorView.focus()
      return
    }

    editorView.dispatch({
      changes: { from: corr.from, to: corr.to, insert: item.value },
      effects: removeCorrection.of(corr.id),
    })
    editorView.focus()
  }, [activeCorrection, editorView])

  const menuItems = useMemo(() => activeCorrection ? buildMenuItems(activeCorrection) : [], [activeCorrection, buildMenuItems])
  const actionableItems = useMemo(() => menuItems.filter((item): item is MenuItem => !isDivider(item)), [menuItems])

  useEffect(() => {
    if (!activeCorrection || actionableItems.length === 0) return
    const handleKeyDown = (e: KeyboardEvent) => {
      const num = parseInt(e.key)
      if (num >= 1 && num <= 9) {
        const item = actionableItems.find(i => i.shortcut === num)
        if (item) { e.preventDefault(); e.stopPropagation(); applyItem(item); return }
      }
      if (e.key === "Enter") {
        const first = actionableItems[0]
        if (first) { e.preventDefault(); e.stopPropagation(); applyItem(first) }
      }
    }
    document.addEventListener("keydown", handleKeyDown, true)
    return () => document.removeEventListener("keydown", handleKeyDown, true)
  }, [activeCorrection, actionableItems, applyItem])

  if (!activeCorrection || !position || menuItems.length === 0) return null

  return createPortal(
    <Card
      ref={popupRef}
      style={{ position: "fixed", top: position.top, left: position.left, zIndex: 9999, minWidth: "15rem", maxWidth: "17.5rem", alignItems: "stretch", animation: "popover 150ms ease-out" }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <CardBody>
        <ButtonGroup>
          {menuItems.map((item, i) => {
            if (isDivider(item)) return <Separator key={`div-${i}`} orientation="horizontal" />
            return (
              <React.Fragment key={`${item.value}-${item.action}-${i}`}>
                {item.title && <Label>{item.title}</Label>}
                <Button data-style="ghost" onMouseDown={(e) => e.preventDefault()} onClick={() => applyItem(item)}>
                  {item.icon}
                  <span className="tiptap-button-text">{item.label}</span>
                  {item.shortcut != null && <Badge>{item.shortcut}</Badge>}
                  {item.isHighlighted && <Badge><IconReturn className="tiptap-badge-icon" /></Badge>}
                </Button>
              </React.Fragment>
            )
          })}
        </ButtonGroup>
      </CardBody>
    </Card>,
    document.body
  )
}
