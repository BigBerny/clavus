import { useCallback, useEffect, useMemo, useRef } from "react"

// --- Lib ---
import { getElementOverflowPosition } from "@/lib/tiptap-collab-utils"

// --- Tiptap UI ---
import type {
  SuggestionMenuProps,
  SuggestionItem,
  SuggestionMenuRenderProps,
} from "@/components/tiptap-ui-utils/suggestion-menu"
import { filterSuggestionItems } from "@/components/tiptap-ui-utils/suggestion-menu"
import { SuggestionMenu } from "@/components/tiptap-ui-utils/suggestion-menu"

// --- Hooks ---
import type { SlashMenuConfig } from "@/components/tiptap-ui/slash-dropdown-menu/use-slash-dropdown-menu"
import { useSlashDropdownMenu } from "@/components/tiptap-ui/slash-dropdown-menu/use-slash-dropdown-menu"
import { useSlashMenuUsage } from "@/components/tiptap-ui/slash-dropdown-menu/use-slash-menu-usage"

// --- UI Primitives ---
import { Button, ButtonGroup } from "@/components/tiptap-ui-primitive/button"
import { Separator } from "@/components/tiptap-ui-primitive/separator"
import {
  Card,
  CardBody,
  CardGroupLabel,
  CardItemGroup,
} from "@/components/tiptap-ui-primitive/card"

import "@/components/tiptap-ui/slash-dropdown-menu/slash-dropdown-menu.scss"

type SlashDropdownMenuProps = Omit<
  SuggestionMenuProps,
  "items" | "children"
> & {
  config?: SlashMenuConfig
}

export const SlashDropdownMenu = (props: SlashDropdownMenuProps) => {
  const { config, ...restProps } = props
  const { getSlashMenuItems } = useSlashDropdownMenu(config)
  const { trackUsage, getTopItems } = useSlashMenuUsage()

  return (
    <SuggestionMenu
      char="/"
      pluginKey="slashDropdownMenu"
      decorationClass="tiptap-slash-decoration"
      decorationContent="Type to search"
      selector="tiptap-slash-dropdown-menu"
      items={({ query, editor }) =>
        filterSuggestionItems(getSlashMenuItems(editor), query)
      }
      {...restProps}
    >
      {(props) => (
        <List
          {...props}
          config={config}
          trackUsage={trackUsage}
          getTopItems={getTopItems}
        />
      )}
    </SuggestionMenu>
  )
}

const Item = (props: {
  item: SuggestionItem
  isSelected: boolean
  onSelect: () => void
}) => {
  const { item, isSelected, onSelect } = props
  const itemRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const selector = document.querySelector(
      '[data-selector="tiptap-slash-dropdown-menu"]'
    ) as HTMLElement
    if (!itemRef.current || !isSelected || !selector) return

    const overflow = getElementOverflowPosition(itemRef.current, selector)

    if (overflow === "top") {
      itemRef.current.scrollIntoView(true)
    } else if (overflow === "bottom") {
      itemRef.current.scrollIntoView(false)
    }
  }, [isSelected])

  const BadgeIcon = item.badge

  return (
    <Button
      ref={itemRef}
      data-style="ghost"
      data-active-state={isSelected ? "on" : "off"}
      onClick={onSelect}
    >
      {BadgeIcon && <BadgeIcon className="tiptap-button-icon" />}
      <div className="tiptap-button-text">{item.title}</div>
      {item.shortcut && (
        <span className="tiptap-slash-item-shortcut">{item.shortcut}</span>
      )}
    </Button>
  )
}

const List = ({
  items,
  selectedIndex,
  onSelect,
  query,
  config,
  trackUsage,
  getTopItems,
}: SuggestionMenuRenderProps & {
  config?: SlashMenuConfig
  trackUsage: (title: string) => void
  getTopItems: (items: SuggestionItem[], count: number) => SuggestionItem[]
}) => {
  const isFiltering = !!query?.trim()

  const handleSelect = useCallback(
    (item: SuggestionItem) => {
      trackUsage(item.title)
      onSelect(item)
    },
    [onSelect, trackUsage]
  )

  const recentlyUsed = useMemo(
    () => (isFiltering ? [] : getTopItems(items, 5)),
    [isFiltering, getTopItems, items]
  )

  const renderedItems = useMemo(() => {
    const rendered: React.ReactElement[] = []
    const showGroups = config?.showGroups !== false

    if (!showGroups || isFiltering) {
      const groupLabel = isFiltering ? "Filtered results" : ""

      const groupItems = items.map((item, index) => (
        <Item
          key={`item-${index}-${item.title}`}
          item={item}
          isSelected={index === selectedIndex}
          onSelect={() => handleSelect(item)}
        />
      ))

      if (groupLabel && groupItems.length > 0) {
        rendered.push(
          <CardItemGroup key="filtered-group">
            <CardGroupLabel>{groupLabel}</CardGroupLabel>
            <ButtonGroup>{groupItems}</ButtonGroup>
          </CardItemGroup>
        )
      } else {
        rendered.push(...groupItems)
      }

      return rendered
    }

    // "Recently used" section at the top (items still appear in their groups below)
    if (recentlyUsed.length > 0) {
      const recentItems = recentlyUsed.map((item) => {
        const originalIndex = items.indexOf(item)
        return (
          <Item
            key={`recent-${item.title}`}
            item={item}
            isSelected={originalIndex === selectedIndex}
            onSelect={() => handleSelect(item)}
          />
        )
      })

      rendered.push(
        <CardItemGroup key="group-recently-used">
          <CardGroupLabel>Recently used</CardGroupLabel>
          <ButtonGroup>{recentItems}</ButtonGroup>
        </CardItemGroup>
      )
    }

    // Regular groups
    const groups: {
      [groupLabel: string]: { items: SuggestionItem[]; indices: number[] }
    } = {}

    items.forEach((item, index) => {
      const groupLabel = item.group || ""
      if (!groups[groupLabel]) {
        groups[groupLabel] = { items: [], indices: [] }
      }
      groups[groupLabel].items.push(item)
      groups[groupLabel].indices.push(index)
    })

    Object.entries(groups).forEach(([groupLabel, groupData], groupIndex) => {
      if (rendered.length > 0 || groupIndex > 0) {
        rendered.push(
          <Separator
            key={`separator-${groupIndex}`}
            orientation="horizontal"
          />
        )
      }

      const groupItems = groupData.items.map((item, itemIndex) => {
        const originalIndex = groupData.indices[itemIndex]
        return (
          <Item
            key={`item-${originalIndex}-${item.title}`}
            item={item}
            isSelected={originalIndex === selectedIndex}
            onSelect={() => handleSelect(item)}
          />
        )
      })

      if (groupLabel) {
        rendered.push(
          <CardItemGroup key={`group-${groupIndex}-${groupLabel}`}>
            <CardGroupLabel>{groupLabel}</CardGroupLabel>
            <ButtonGroup>{groupItems}</ButtonGroup>
          </CardItemGroup>
        )
      } else {
        rendered.push(...groupItems)
      }
    })

    return rendered
  }, [
    items,
    selectedIndex,
    handleSelect,
    config?.showGroups,
    isFiltering,
    recentlyUsed,
  ])

  return (
    <Card
      className="tiptap-slash-card"
      style={{
        maxHeight: "var(--suggestion-menu-max-height)",
      }}
    >
      <CardBody className="tiptap-slash-card-body">
        {renderedItems.length > 0 ? (
          renderedItems
        ) : (
          <div className="tiptap-slash-no-results">No results</div>
        )}
      </CardBody>
    </Card>
  )
}
