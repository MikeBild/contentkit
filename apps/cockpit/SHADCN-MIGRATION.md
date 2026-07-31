# shadcn API cheatsheet for the cockpit migration

Verified on 2026-07-30 against `npx shadcn@latest docs <component>` + the fetched doc
pages **and** the source actually installed in `apps/cockpit/src/components/ui/`.
Where the doc page and the installed file disagree, **the installed file wins** and the
difference is called out. Nothing here is recalled from memory.

Re-verify a component with:

```
cd apps/cockpit
npx shadcn@latest docs <component>       # prints docs + examples + upstream api URLs
npx shadcn@latest info                   # style / base / registry / installed list
```

---

## 0. Project facts that change every call site

| Fact | Value | Consequence |
| --- | --- | --- |
| `style` | `radix-nova` | Extra parts exist that upstream default-style does not have (`AlertAction`, `PopoverHeader`, `AlertDialogMedia`, `DialogFooter showCloseButton`). |
| **`base`** | **`radix`** | **`asChild`, never `render`.** See §0.1. |
| Radix package | `radix-ui@^1.6.7`, one package | `import { Dialog as DialogPrimitive } from "radix-ui"` — **not** `@radix-ui/react-dialog`. Slot is `import { Slot } from "radix-ui"` → `Slot.Root`. |
| Tailwind | v4, `src/index.css`, no config file | `@theme` tokens only; `--sidebar-*`, `--radius`, `--cell-size` are CSS vars. |
| Icons | `lucide-react@^1.27.0` | |
| cmdk | `1.1.1` | Command is cmdk, not Radix. |
| react-day-picker, date-fns | **NOT INSTALLED** — removed 2026-07-30 | Neither is in `package.json` or `package-lock.json`, and nothing under `src/` imports either. `ui/calendar.tsx` is deleted; §15 and §26.1 record why. The v10 notes there are kept for a future `shadcn add calendar`, not for a package this project has. |
| sonner | `2.0.7` | `toast` from `"sonner"`, `Toaster` from `@/components/ui/sonner`. |
| `@tanstack/react-table` | **NOT INSTALLED** | See §14. Do not install it. |
| lint | eslint does **not** cover `apps/cockpit` | Two gates, not one: `npm --prefix apps/cockpit run build` (`tsc --noEmit`) reads the types, and `npm --prefix apps/cockpit run test` (vitest + jsdom, `src/**/*.test.tsx`) renders the components and asks the DOM. CI's `cockpit` job runs both. **Corrected 2026-07-30** — this row used to say `tsc` was the only gate, which was true until the DOM suite existed. |

### 0.1 `asChild`, not `render`

`npx shadcn@latest info` reports `base radix`. Confirmed in source: 8 installed files
use `asChild` (`sidebar.tsx` 16×, `breadcrumb.tsx`, `badge.tsx`, `button.tsx`,
`dialog.tsx`, `sheet.tsx`, `select.tsx`, `alert-dialog.tsx`); **zero** files use a
`render` prop. The `base-ui` `render={<Link/>}` form does not exist here and will not
typecheck.

```tsx
// correct in this project
<SidebarMenuButton asChild isActive={active}>
  <Link to="/sites">Sites</Link>
</SidebarMenuButton>
```

### 0.2 State-variant shorthand in this style

`radix-nova` uses `data-open:`, `data-closed:`, `data-selected:`, `data-active:`,
`data-disabled:`, `data-inset:` — **not** `data-[state=open]:`. Match it when you add
layout classes so overrides land on the same variant.

### 0.3 Button surface (needed by almost every recipe)

`variant`: `default | outline | secondary | ghost | destructive | link`
`size`: `default | xs | sm | lg | icon | icon-xs | icon-sm | icon-lg`
plus `asChild`. **No `isPending`, no `loading`.** Loading = `Spinner` + `disabled`.
Icons inside a Button carry `data-icon="inline-start" | "inline-end"` and **no size
class** (the CVA sizes them per button size).

---

## 1. The migration worklist: 42 real `tsc` errors — ✅ ALL CLEARED 2026-07-30

> **Corrected 2026-07-30.** This section used to open "`npx tsc --noEmit` in
> `apps/cockpit` currently fails". It does not: `npx tsc --noEmit` exits **0**, the DOM
> suite is **28 passed (4 files)** and the Node suite is **940 pass / 0 fail**. Every row
> below is now a record of what was changed, not a list of what is broken — kept because
> the mapping from each old symbol to its replacement is the reason the call sites read
> the way they do. Where an item was resolved differently from the plan, the resolution
> is written next to it.
>
> **Corrected again 2026-07-31.** The paragraph above described a tree that no longer
> exists: a `git reset --hard HEAD` destroyed every unstaged edit to a tracked file, so
> the deleted modules came back and the vendored ones that had replaced an existing file
> were reverted to their old contents. Do not read a ✅ here as "true today" — read it as
> "this is the shape it is meant to end in". What is actually outstanding, as of this
> edit:
>
> - **`components/ui/dialog.tsx` is still the console's own overlay**, and twelve modules
>   still import `Dialog`/`DialogActions` from it with the `title`/`onClose`/`size` props
>   §4 says are gone. This is the largest single piece left, and it is what forced the
>   deviation recorded in §7.
> - ~~**`components/ui/primitives.tsx` and `components/ui/empty-state.tsx` are back**~~ —
>   **deleted again 2026-07-31, and this time nothing is left importing either.** The
>   five modules that still reached into primitives came off it in the same change:
>   `components/session-gate.tsx`, `components/ui/copy-button.tsx`,
>   `components/ui/data-table.tsx`, `components/ui/dialog.tsx`,
>   `components/ui/pagination.tsx` (`app/shell.tsx` and `ui/command-palette.tsx` had
>   already). `ui/skeleton.tsx` was the one that had to go first: it took `TD`/`TR` from
>   primitives, so the *new* stack depended on the old one and no amount of call-site
>   work could delete the file. `grep -rl components/ui/primitives apps/cockpit/src`
>   returns nothing.
> - ~~**`ui/progress.tsx` and `ui/spinner.tsx` are the pre-migration versions**~~ —
>   **redone 2026-07-31.** `ui/progress.tsx` now takes the fraction from
>   `./progress-value` *before* it draws anything and branches on it: a fraction that
>   exists is `ProgressPrimitive.Root` from `radix-ui`, one that does not is this file's
>   own named `progressbar` with no value on it, because Radix's root emits a minimum and
>   a maximum unconditionally. `ui/spinner.tsx` is `Loader2Icon`, always `aria-hidden`,
>   wrapped in a `role="status"` only when the caller supplies a sentence (`label`, or
>   `aria-label` — `const announcement = label ?? ariaLabel`); it never invents the word
>   "Loading". `pages/authoring.tsx` came with them: the budget bar is
>   `data-testid="audio-budget-bar"`, named by `aria-label`, handed the API's two numbers
>   raw (`value={budget.used} max={budget.budget}`) instead of a pre-rounded percentage,
>   and the escalation is a `Badge` (`audio-budget-tone`) as well as a tint.
> - ~~`ui/toast.tsx`, `ui/chip.tsx` and `ui/segmented.tsx` are the pre-migration versions
>   too~~ — **redone 2026-07-31.** `ui/toast.tsx` is sonner: no `createContext`, no
>   `setTimeout`, no queue of ours. It keeps the console's `toast({ tone, title, detail })`
>   vocabulary over two tables — `DURATION` (`warning`/`danger` are
>   `Number.POSITIVE_INFINITY`, with `closeButton` as the way out) and `EMIT` (one row per
>   tone, so a severity cannot be quietly downgraded) — and passes `theme={resolved}` from
>   `@/lib/theme`, which is what overrides the `next-themes` read inside stock
>   `ui/sonner.tsx`. `ui/chip.tsx` is a `Badge` plus a remove control; `ui/segmented.tsx`
>   is `ToggleGroup type="single" spacing={0}`, which is where `role="radiogroup"`, the
>   roving tabindex and the arrow keys come from. Neither takes a `chart-*` colour any
>   more.
> - **`components/confirm.tsx`: one string, not one component.** The rebuild was intact
>   after the reset; the single failing assertion was `doesNotMatch(body, /role="dialog"/)`
>   matching the *selector* `'[role="dialog"]'` in `ANNOUNCED_ANCHOR`. The selectors are
>   built unquoted (`[role=dialog]`) now — identical to CSS, and no longer reads as this
>   component setting a role it must never set.
> - ~~`forms/fields/` is imported both through its barrel and by file path, which
>   one-stack reads as two modules owning one name.~~ **Not a finding, and no longer
>   reported as one.** One-stack now follows `export … from` to the module that
>   *declares* each name, so a barrel and a direct path agree; `forms/fields/field.test.tsx`
>   keeps its by-path imports, which `cockpit-behavioural-floor.test.mjs` needs in order
>   to prove those modules are really rendered.
>
> Green as of 2026-07-31, end of day, on the whole branch and not on a selection of it:
> `npm run lint` clean, `node --test test/unit/*.test.mjs test/contract/*.test.mjs`
> **950 pass / 0 fail** on Node 22 and **795 pass / 0 fail / 3 skipped** on Node 20 (the
> three are the behavioural halves that import a `.ts`, skipping with their reason
> printed — the documented degradation, not a silent pass),
> `npm --prefix apps/cockpit run test` **59 passed (5 files)**,
> `npm --prefix apps/cockpit run build` (i.e. `tsc --noEmit` + vite) exits 0, and both
> drift checks pass. The only piece of §1 still outstanding is the first bullet:
> `ui/dialog.tsx`.

**Exports that no longer exist**

| Missing symbol | Imported by |
| --- | --- |
| `DialogActions` from `@/components/ui/dialog` | `forms/audience/{groups,readers,rules}.tsx`, `forms/platform/{api-keys,identity,previews,webhooks}.tsx`, `forms/site/wizard.tsx`, `pages/sites.tsx` (9 files) |
| `SkeletonRows` from `./skeleton` | `components/ui/data-table.tsx:26` |
| `SkeletonGroup` from `@/components/ui/skeleton` | `components/ui/release-chain.tsx:4`, `pages/overview.tsx:7` |
| `SkeletonFields`, `SkeletonText` from `@/components/ui/skeleton` | `pages/content.tsx:24` |
| `Crumb` (type) from `@/components/ui/breadcrumb` | `app/shell.tsx:25` |
| `TabPanel` from `@/components/ui/tabs` | `forms/content/editor.tsx:5`, `pages/content.tsx:25` |

**Props that no longer exist**

| Old prop | On | Call sites |
| --- | --- | --- |
| `size`, `onClose`, `title`, `description`, `footer`, `busy` | `Dialog` | 15 sites: `use-unsaved-guard.tsx:47`, `forms/platform/previews.tsx:58`, `forms/platform/identity.tsx:136`, `forms/platform/webhooks.tsx:82`, `forms/platform/api-keys.tsx:63`, `forms/content/revisions.tsx:94`, `forms/audience/readers.tsx:119`, `forms/audience/rules.tsx:83`, `forms/audience/groups.tsx:58,160`, `forms/site/wizard.tsx:176`, `forms/site/conflict.tsx:40`, `pages/sites.tsx:150`, `pages/site-settings.tsx:337`, `pages/authoring.tsx:580,634`, `components/ui/command-palette.tsx:138` |
| `label`, `valueLabel`, `tone`, `since` | `Progress` | `pages/authoring.tsx:978`, `pages/releases.tsx:174` |
| `content` | `Tooltip` | `forms/fields/scopes.tsx:82`, `forms/fields/map.tsx:198` |
| `items` | `Breadcrumb` | `app/shell.tsx:659` |
| `size` on a lucide icon | `components/ui/pagination.tsx:58` |

**Also unwired (no tsc error, but wrong at runtime) — ✅ ALL THREE WIRED 2026-07-30**

- ~~`TooltipProvider` is **not mounted anywhere** in `src/`.~~ **Mounted**, once, in
  `app/shell.tsx` as the outermost element of `Shell()` — outside `SidebarProvider`, so
  the `Outlet` and therefore every route is inside it. Line numbers are not quoted any
  more: the mount moved twice and both citations were stale within a day. Grep
  `<TooltipProvider>`; `test/unit/cockpit-navigation.test.mjs` asserts it is there,
  because without it Radix renders no tooltip at all and the collapsed icon rail loses
  every label at once. That mount is what `SidebarMenuButton tooltip=…` needs too.
  `forms/fields/scopes.tsx` and
  `forms/fields/map.tsx` each still open a local `TooltipProvider`; nesting is legal and
  both say why in a comment, but the root one is the load-bearing mount.
- ~~`Toaster` is **not mounted anywhere**.~~ **Mounted** by `ToastProvider` in
  `components/ui/toast.tsx`, which `router.tsx` already wraps the Shell in — so mounting
  it needed no change there. That file also keeps the console's `toast({ tone, title,
  detail })` vocabulary over sonner's method names, and forces `duration: Infinity` for
  `warning`/`danger` with `closeButton` as the way out.
- `ui/sonner.tsx` still imports `useTheme` from `next-themes`, and that is **deliberate,
  not an oversight**: the file is left exactly as shadcn wrote it, and `ToastProvider`
  neutralises it by passing `theme={resolved}` from `@/lib/theme`. That works *because*
  `ui/sonner.tsx` spreads `{...props}` after its own `theme=`, so the caller's value
  wins — the ordering is the whole mechanism, and reversing it would silently restore
  the bug. Editing `ui/sonner.tsx` is therefore not required. **Left over:**
  `next-themes` remains a runtime dependency whose only importer is that one always-
  overridden call, so it is bundled for nothing.

---

## 2. House rules restated as API facts

- `className` is layout only. Colour/typography come from semantic tokens already baked
  into the CVAs. Never a raw colour, never a manual `dark:` override.
- No `space-x-*` / `space-y-*` → `flex … gap-*`. `size-*` when w == h.
- Forms: `FieldGroup > Field > FieldLabel + control + FieldDescription`. Never a bare
  `div` + `Label`.
- Empty state → `Empty`. Callout → `Alert`. Loading → `Skeleton` / `Spinner`. Badge →
  `Badge`. Divider → `Separator`.
- Items live in their group: `SelectItem` in `SelectGroup`, `CommandItem` in
  `CommandGroup`, `DropdownMenuItem` in `DropdownMenuGroup`.
- Dialog / Sheet / Drawer always carry a Title (`sr-only` if hidden).
- No manual `z-index` on overlays — the parts already set `z-50`.
- Every interactive element keeps its `data-testid`. All these components spread
  `...props` onto the DOM node, so `data-testid` passes through everywhere. Two
  exceptions worth knowing: `Sidebar` spreads `...props` onto the *desktop container*
  div (and onto `Sheet` on mobile), and `CommandDialog` spreads `...props` onto
  `Dialog` (not the content) — put `data-testid` on the inner part you actually assert.

---

## 3. Composition map (one screen)

```
SidebarProvider > Sidebar > SidebarContent > SidebarGroup > SidebarMenu(ul)
                                                          > SidebarMenuItem(li)
                                                          > SidebarMenuButton
Dialog > DialogTrigger(asChild) + DialogContent > DialogHeader > DialogTitle
                                                              > DialogDescription
                                               > DialogFooter > DialogClose(asChild)
CommandDialog > Command > CommandInput + CommandList > CommandEmpty
                                                     > CommandGroup > CommandItem
FieldGroup > Field > FieldLabel + <control> + FieldDescription | FieldError
Empty > EmptyHeader > EmptyMedia + EmptyTitle + EmptyDescription
      > EmptyContent
Alert > <Icon> + AlertTitle + AlertDescription + AlertAction
InputGroup > InputGroupInput + InputGroupAddon > InputGroupButton | InputGroupText
Popover > PopoverTrigger(asChild) + PopoverContent > Calendar       ← the "DatePicker"
Breadcrumb > BreadcrumbList(ol) > BreadcrumbItem(li) > BreadcrumbLink | BreadcrumbPage
                                > BreadcrumbSeparator(li)  ← written by hand, never auto
```

---

## 4. dialog

`docs https://ui.shadcn.com/docs/components/radix/dialog` ·
`api https://www.radix-ui.com/docs/primitives/components/dialog.md`

**Exports** `Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter,
DialogHeader, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger`.

**Props that exist**

- `Dialog` — Radix Root: `open`, `onOpenChange`, `defaultOpen`, `modal`. Nothing else.
- `DialogContent` — Radix Content (`onEscapeKeyDown`, `onPointerDownOutside`,
  `onInteractOutside`, `onOpenAutoFocus`, `onCloseAutoFocus`, `forceMount`,
  `aria-describedby`) **plus `showCloseButton?: boolean` (default `true`)**.
- `DialogFooter` — plain `div` **plus `showCloseButton?: boolean` (default `false`)**,
  which renders its own `<Button variant="outline">Close</Button>` wrapped in
  `DialogPrimitive.Close asChild`. This is a `radix-nova` extra; upstream default style
  has no such prop.
- `DialogHeader`, `DialogTitle`, `DialogDescription` — plain parts + Radix Title/Description.

**Props that do NOT exist:** `size`, `title`, `description`, `footer`, `busy`,
`onClose`, `isPending`.

**`DialogContent` already renders `DialogPortal` + `DialogOverlay` itself.** Do not wrap
it. The exported `DialogPortal`/`DialogOverlay` exist only for a fully custom content.

**The close button's test id — a local change, 2026-07-30.** Stock renders the `X` (and
`DialogFooter showCloseButton`'s `Close`) with no `data-testid`, so the one control all
17 of this console's dialogs have in common was the one control no browser test could
name — and no source-reading test can see a missing attribute on a component it does not
open. `DialogContent` and `DialogFooter` now destructure `data-testid` and derive the
button's from it, the way `ui/dropzone.tsx` derives `-input` and `ui/progress.tsx`
derives `-bar`:

```
<DialogContent data-testid="ck-site-delete-dialog">  →  X button is  ck-site-delete-dialog-close
<DialogContent> with no id                           →  X button is  dialog-close
```

Nothing else changes: the id is still forwarded to the panel exactly as `{...props}` used
to forward it. `shadcn add dialog` would revert this.

Default width is `w-full max-w-[calc(100%-2rem)] sm:max-w-sm`. There is no `size`
prop — widen via `className="sm:max-w-lg"` (layout, allowed).

### Exact replacement shape for the old `Dialog`

Old (still in 15 places, e.g. `pages/sites.tsx:148`):

```tsx
<Dialog
  open
  size="default"
  data-testid="ck-site-delete-dialog"
  title={`Delete ${site.name}?`}
  description="…"
  busy={remove.isPending}
  onClose={() => setOpen(false)}
  footer={
    <DialogActions>
      <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
      <Button variant="destructive" size="sm" disabled={remove.isPending}>Delete</Button>
    </DialogActions>
  }
>
  {body}
</Dialog>
```

New:

```tsx
<Dialog open={open} onOpenChange={(next) => { if (!next) setOpen(false) }}>
  <DialogContent data-testid="ck-site-delete-dialog" className="sm:max-w-md">
    <DialogHeader>
      <DialogTitle>Delete {site.name}?</DialogTitle>
      <DialogDescription>…</DialogDescription>
    </DialogHeader>
    {body}
    <DialogFooter>
      <DialogClose asChild>
        <Button variant="outline" size="sm" data-testid="ck-site-delete-cancel">
          Cancel
        </Button>
      </DialogClose>
      <Button
        variant="destructive"
        size="sm"
        data-testid="ck-site-delete-confirm"
        disabled={remove.isPending}
        onClick={confirm}
      >
        {remove.isPending && <Spinner data-icon="inline-start" />}
        Delete
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

Prop-by-prop mapping:

| old prop | new |
| --- | --- |
| `open` | `Dialog open` |
| `onClose` | `Dialog onOpenChange={(o) => !o && close()}`, or `DialogClose asChild` on the button |
| `title` | `DialogHeader > DialogTitle` (required for a11y; `className="sr-only"` if hidden) |
| `description` | `DialogHeader > DialogDescription` |
| `footer` | `DialogFooter` as a child of `DialogContent` |
| `DialogActions` | delete the wrapper — `DialogFooter` is already the reversed-column / `sm:flex-row sm:justify-end` row |
| `busy` | `disabled` on the confirm Button + `<Spinner data-icon="inline-start" />`; optionally `DialogContent onEscapeKeyDown`/`onInteractOutside={(e) => busy && e.preventDefault()}` to keep it non-dismissable |
| `size="default"` | drop it; width via `className` on `DialogContent` |
| `data-testid` | move onto `DialogContent` (asserting the panel, not the invisible Root) |

Sites where the old dialog had no footer (`pages/authoring.tsx:580,634`,
`pages/site-settings.tsx:337`, `forms/content/revisions.tsx:94`) just omit
`DialogFooter`, or use `<DialogFooter showCloseButton />` for a bare Close.

---

## 5. alert-dialog

`docs …/radix/alert-dialog` · `api https://www.radix-ui.com/primitives/docs/components/alert-dialog.md`

**Exports** `AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia,
AlertDialogOverlay, AlertDialogPortal, AlertDialogTitle, AlertDialogTrigger`.

```
AlertDialog > AlertDialogTrigger(asChild)
            > AlertDialogContent > AlertDialogHeader > AlertDialogMedia
                                                     > AlertDialogTitle
                                                     > AlertDialogDescription
                                 > AlertDialogFooter > AlertDialogCancel
                                                     > AlertDialogAction
```

- `AlertDialogContent` — Radix Content **plus `size?: "default" | "sm"`** (default
  `"default"`; `sm` makes the footer a 2-col grid). Renders its own Portal + Overlay.
- **`AlertDialogAction` / `AlertDialogCancel` take `variant` and `size` directly**
  (`Pick<ButtonProps, "variant" | "size">`; Action defaults `variant="default"`, Cancel
  defaults `variant="outline"`). They wrap `<Button … asChild>` internally. You do
  **not** pass `className={buttonVariants({…})}` — that is the old pre-nova idiom.
- `AlertDialogMedia` — 40px muted square for an icon; `AlertDialogHeader` re-grids when
  it is present.
- No `size`/`title`/`description`/`footer`/`busy`/`onClose` props on the root.

Use this instead of `Dialog` for the destructive confirms (`pages/sites.tsx`,
`forms/site/conflict.tsx`, `use-unsaved-guard.tsx`) — it traps focus on Cancel and has
no dismiss-on-outside-click.

**`components/confirm.tsx` is its first importer** (2026-07-30) and covers all 25
mutation confirmations on its own. Two notes from doing it, both non-obvious:
`AlertDialogAction` closes the dialog on click, so an async confirm must
`event.preventDefault()` and let the *answer* close it; and the trigger stays the
caller's own control (a `children(open)` render prop, no `AlertDialogTrigger`) because
the caller's `data-testid`, `disabled` and scope check belong on that button.

---

## 6. sidebar

`docs …/radix/sidebar` · example
`https://raw.githubusercontent.com/shadcn-ui/ui/refs/heads/main/apps/v4/registry/bases/radix/examples/sidebar-example.tsx`

**Full export set** (23 symbols; the doc page's list omits `SidebarSeparator` — the
installed file exports it):

```
SidebarProvider, Sidebar, SidebarHeader, SidebarFooter, SidebarContent,
SidebarSeparator, SidebarGroup, SidebarGroupLabel, SidebarGroupAction,
SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton,
SidebarMenuAction, SidebarMenuBadge, SidebarMenuSkeleton, SidebarMenuSub,
SidebarMenuSubItem, SidebarMenuSubButton, SidebarTrigger, SidebarRail,
SidebarInset, SidebarInput, useSidebar
```

**Required composition** — note the element types, they are not interchangeable:

```
SidebarProvider (div, owns CSS vars + shortcut + cookie)
├── Sidebar (div | Sheet on mobile)
│   ├── SidebarHeader
│   ├── SidebarContent
│   │   └── SidebarGroup
│   │       ├── SidebarGroupLabel        (div, asChild)
│   │       ├── SidebarGroupAction       (button, asChild)
│   │       └── SidebarGroupContent
│   │           └── SidebarMenu          <ul>
│   │               └── SidebarMenuItem  <li>
│   │                   ├── SidebarMenuButton  (button, asChild)
│   │                   ├── SidebarMenuAction  (button, asChild)
│   │                   ├── SidebarMenuBadge   (div)
│   │                   └── SidebarMenuSub     <ul>
│   │                       └── SidebarMenuSubItem <li>
│   │                           └── SidebarMenuSubButton  ← <a>, not <button>
│   ├── SidebarFooter
│   └── SidebarRail
├── SidebarInset   ← <main>, sibling of Sidebar
└── SidebarTrigger (usually inside SidebarInset's header)
```

**Props**

| Component | Props |
| --- | --- |
| `SidebarProvider` | `defaultOpen?: boolean = true`, `open?`, `onOpenChange?`, plus all `div` props (`style` for `--sidebar-width`, `--sidebar-width-mobile`) |
| `Sidebar` | `side?: "left" \| "right" = "left"`, `variant?: "sidebar" \| "floating" \| "inset" = "sidebar"`, `collapsible?: "offcanvas" \| "icon" \| "none" = "offcanvas"`, `dir?` |
| `SidebarMenuButton` | `asChild?`, `isActive?: boolean = false`, `tooltip?: string \| TooltipContentProps`, `variant?: "default" \| "outline"`, `size?: "default" \| "sm" \| "lg"` |
| `SidebarMenuSubButton` | `asChild?`, `isActive?`, `size?: "sm" \| "md" = "md"` (note: **`md`**, not `default`) |
| `SidebarMenuAction` | `asChild?`, `showOnHover?: boolean = false` |
| `SidebarMenuSkeleton` | `showIcon?: boolean = false` |
| `SidebarGroupLabel`, `SidebarGroupAction` | `asChild?` |
| `SidebarTrigger` | all `Button` props (already `variant="ghost" size="icon-sm"`) |
| `SidebarRail` | plain `button` props |
| `SidebarInput` | all `Input` props |
| `SidebarInset` | plain `main` props |

`useSidebar()` returns exactly:

```ts
{ state: "expanded" | "collapsed"; open: boolean; setOpen(open: boolean): void;
  openMobile: boolean; setOpenMobile(open: boolean): void;
  isMobile: boolean; toggleSidebar(): void }
```

It **throws** `"useSidebar must be used within a SidebarProvider."` outside the provider.

**How `collapsible="icon"` works**

1. `SidebarProvider` puts `--sidebar-width: 16rem` and `--sidebar-width-icon: 3rem` on
   its wrapper div.
2. `Sidebar` sets `data-collapsible={state === "collapsed" ? collapsible : ""}` — the
   attribute is **only present while collapsed**, so `group-data-[collapsible=icon]:*`
   is the collapsed-state selector, not a mode selector.
3. Collapsed, the container narrows to `--sidebar-width-icon`; `SidebarMenuButton` is
   forced to `size-8! p-2!`; `[&>span:last-child]:truncate` hides the label. So put the
   label in a `<span>` and the icon as a bare sibling.
4. Auto-hidden while collapsed: `SidebarGroupLabel` (`-mt-8 opacity-0`),
   `SidebarGroupAction`, `SidebarMenuAction`, `SidebarMenuBadge`, `SidebarMenuSub`,
   `SidebarMenuSubButton`. Hide a whole group with
   `className="group-data-[collapsible=icon]:hidden"`.
5. `tooltip` on `SidebarMenuButton` renders `Tooltip/TooltipTrigger/TooltipContent` with
   `side="right" align="center"` and `hidden={state !== "collapsed" || isMobile}` — the
   label reappears as a tooltip only when collapsed on desktop. **Requires a
   `TooltipProvider` ancestor** — mounted as the outermost element of `Shell()` in
   `app/shell.tsx` (§1).
6. `variant="floating"|"inset"` widen the collapsed rail to
   `calc(var(--sidebar-width-icon) + --spacing(4))` and need `SidebarInset` for the main
   pane.

**Keyboard shortcut** — `SIDEBAR_KEYBOARD_SHORTCUT = "b"` (module constant, line 32) and
the handler is `event.key === "b" && (event.metaKey || event.ctrlKey)`, i.e. **⌘B /
Ctrl+B, no Shift**, `preventDefault()`, window-level `keydown`, bound in
`SidebarProvider`. Changing it means editing that constant in `ui/sidebar.tsx`; there is
no prop.

**Other behaviours to know**

- Open state is persisted to `document.cookie` as `sidebar_state` (`max-age` 7 days).
  Cockpit is a Vite SPA with no SSR read of that cookie, so `defaultOpen` is what
  actually applies on load unless you read the cookie yourself.
- On mobile (`useIsMobile()`, `MOBILE_BREAKPOINT = 768`) `Sidebar` renders a `Sheet`
  with its own `sr-only` `SheetTitle`/`SheetDescription` and `[&>button]:hidden`. Do not
  add your own Sheet.
- `collapsible="none"` returns a plain always-open div; `side`/`variant` are ignored.
- `Sidebar` spreads `...props` onto the desktop container div — and onto `Sheet` on
  mobile — so a `data-testid` on `Sidebar` disappears at mobile widths. Put test ids on
  `SidebarMenuButton`/`SidebarTrigger` instead.

**What `app/shell.tsx` actually composes** (done 2026-07-31; graded by
`test/unit/cockpit-navigation.test.mjs`):

```
TooltipProvider                        ← outermost; without it no tooltip renders at all
└── SidebarProvider
    ├── Sidebar collapsible="icon"
    │   ├── SidebarHeader
    │   │   ├── <div data-testid="site-switcher-scope" data-relation={…}>
    │   │   │     SiteSwitcher   ← DropdownMenu + DropdownMenuRadioGroup, team-switcher
    │   │   │     <div data-testid="site-switcher-note">   ← what it does to THIS page
    │   │   └── CommandPalette   ← the ⌘K trigger, directly beneath, with its Kbd hint
    │   ├── SidebarContent > <nav data-testid="nav"> > GROUPS.map(NavBlock)
    │   ├── SidebarFooter  ← theme toggle, sign out, operator identity
    │   └── SidebarRail
    └── SidebarInset > header(SidebarTrigger) + Outlet
```

Three things that are not obvious and are each pinned by a test:

- **A block is `Collapsible` wrapping `SidebarGroup`, not the other way round**, with
  `SidebarGroupLabel asChild > CollapsibleTrigger` as the only clickable heading. A block
  with no heading (Overview) therefore cannot be collapsible — there would be nothing to
  click — so `collapsible === (label !== '')` is a rule, not a coincidence.
- **`open={state === 'collapsed' || expanded}`.** In the rail there is no heading to
  click, so a closed block must still show its icons or its pages become unreachable.
- **A tooltip on a `DropdownMenuTrigger` cannot come from `SidebarMenuButton tooltip=`.**
  `tooltip=` makes the button return `Tooltip > TooltipTrigger asChild > button`, and
  `DropdownMenuTrigger asChild` would then clone the Tooltip *Root*, which renders no DOM
  node. The working nesting is `Tooltip > TooltipTrigger asChild > DropdownMenuTrigger
  asChild > SidebarMenuButton`, with `TooltipContent hidden={state !== 'collapsed'}` doing
  by hand what `tooltip=` does for the plain buttons.

---

## 7. command

`docs …/radix/command` · `api https://github.com/dip/cmdk` (cmdk 1.1.1)

**Exports** `Command, CommandDialog, CommandInput, CommandList, CommandEmpty,
CommandGroup, CommandItem, CommandShortcut, CommandSeparator`.

```
Command                       (cmdk Command root)
├── CommandInput
└── CommandList
    ├── CommandEmpty
    ├── CommandGroup heading="…"
    │   └── CommandItem  (+ CommandShortcut inside it)
    └── CommandSeparator
```

**How it composes inside Dialog — the important detail**

`CommandDialog` in the installed source is `Dialog > DialogHeader(sr-only) +
DialogContent`. It **does not render `Command` for you.** You must nest `Command`
yourself:

```tsx
<CommandDialog open={open} onOpenChange={setOpen} title="Command palette"
               description="Search for a command to run…">
  <Command>
    <CommandInput placeholder="Type a command…" data-testid="ck-cmdk-input" />
    <CommandList>
      <CommandEmpty>No results found.</CommandEmpty>
      <CommandGroup heading="Suggestions">
        <CommandItem value="sites" onSelect={goSites} data-testid="ck-cmdk-sites">
          <LayoutGridIcon />
          <span>Sites</span>
          <CommandShortcut>⌘S</CommandShortcut>
        </CommandItem>
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup heading="Settings">…</CommandGroup>
    </CommandList>
  </Command>
</CommandDialog>
```

`CommandDialog` props: `title?: string = "Command Palette"`,
`description?: string = "Search for a command to run..."`, `className?`,
`showCloseButton?: boolean = false`, **plus everything `Dialog` takes** (`open`,
`onOpenChange`, `defaultOpen`, `modal`) — `...props` is spread onto `Dialog`, so
`data-testid` on `CommandDialog` lands on the invisible Root, not the panel. Put it on
`Command` or on the items.

Quirks of the installed version, all verified in source:

- The `sr-only` `DialogHeader`/`DialogTitle`/`DialogDescription` is rendered **outside**
  `DialogContent` (`command.tsx:49-52`). It still satisfies the "Dialog must have a
  Title" rule via Radix context. **Do not add a second `DialogTitle`** inside.
- `className` on `CommandDialog` goes to `DialogContent`, which is already
  `top-1/3 translate-y-0 p-0 rounded-xl!`.
- `CommandInput` wraps itself in an `InputGroup` with a trailing `SearchIcon`
  `InputGroupAddon`. Do not wrap it again and do not add your own search icon.
- `CommandItem` appends its own `<CheckIcon>` that is `opacity-0` unless
  `data-checked="true"` on the item, and is `hidden` when the item contains a
  `CommandShortcut`. So: never hand-roll a check mark; use `data-checked` for
  multi-select rows.
- `Command` root already carries `bg-popover p-1 rounded-xl!`.

cmdk props that exist on `Command`: `value`, `onValueChange`, `filter`, `shouldFilter`,
`loop`, `label`, `vimBindings`, `disablePointerSelection`. On `CommandItem`: `value`,
`onSelect`, `disabled`, `keywords`, `forceMount`. On `CommandGroup`: `heading`,
`value`, `forceMount`. On `CommandList`: nothing beyond `div` props.

~~`components/ui/command-palette.tsx:138` is the current break: it passes `onClose`,
`title`, `description`, `size` to the old `Dialog`.~~ **Done** — that file now imports
`CommandDialog` and composes exactly the shape above; the ⌘K handler stayed where it was.
Its groups are `Page` / `Site` / `Content`, written out as a constant so an empty group
cannot reorder the two that are left under someone already typing.

### `CommandDialog` here does NOT stand on `ui/dialog.tsx` — corrected 2026-07-31

The stock file composes `CommandDialog` out of `Dialog`, `DialogContent`, `DialogHeader`,
`DialogTitle` and `DialogDescription` from `@/components/ui/dialog`. **None of those five
names exists in this project.** `ui/dialog.tsx` is still the console's own overlay —
`Dialog` there takes `title` / `onClose` / `size` and renders a panel, it is not a Radix
Root — so `shadcn add command` writes a file that does not compile here. That was five of
the fourteen `tsc` errors on the branch.

So `command.tsx` builds the modal on `Dialog` from **`radix-ui`** directly, with the same
overlay and content classes `ui/sheet.tsx` and `ui/alert-dialog.tsx` already use. The
caller-facing shape is unchanged (`CommandDialog > Command > CommandInput + CommandList`,
and `title` / `description` / `showCloseButton` behave as documented above), and one
thing is deliberately better than stock: the `sr-only` title and description are rendered
**inside** `DialogPrimitive.Content`, not beside it. Radix wires them by context either
way, but a labelling element outside the dialog is not in the subtree it labels.

**This is a workaround, not the destination.** The real fix is to vendor shadcn's
`dialog.tsx` and migrate the twelve modules still importing `Dialog` / `DialogActions`
from `@/components/ui/dialog` (§4 has the replacement shape). When that lands, revert this
`CommandDialog` to the stock composition — it is a single function.

---

## 8. breadcrumb

`docs …/radix/breadcrumb`

**Exports** `Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink,
BreadcrumbPage, BreadcrumbSeparator, BreadcrumbEllipsis`. **No `Crumb` type**
(`app/shell.tsx:25` imports one) and **no `items` prop** (`app/shell.tsx:659` passes
one). It is fully compositional; separators are written by hand and never auto-inserted.

```tsx
<Breadcrumb data-testid="ck-breadcrumb">
  <BreadcrumbList>
    <BreadcrumbItem>
      <BreadcrumbLink asChild><Link to="/">Cockpit</Link></BreadcrumbLink>
    </BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem><BreadcrumbEllipsis /></BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem><BreadcrumbPage>Settings</BreadcrumbPage></BreadcrumbItem>
  </BreadcrumbList>
</Breadcrumb>
```

Element types: `Breadcrumb` = `<nav aria-label="breadcrumb">`, `BreadcrumbList` =
`<ol>`, `BreadcrumbItem` = `<li>`, `BreadcrumbSeparator` = **`<li role="presentation"
aria-hidden>`** (so it must be a direct child of `BreadcrumbList`, never inside an item),
`BreadcrumbPage` = `<span role="link" aria-disabled aria-current="page">`,
`BreadcrumbEllipsis` = `<span>` + `MoreHorizontalIcon` + `sr-only "More"`.
Only `BreadcrumbLink` takes `asChild`. `BreadcrumbSeparator` renders `ChevronRightIcon`
unless you pass children.

~~`app/shell.tsx` must own the loop that was previously `items={crumbs}`, and define its
own crumb type locally (the old `Crumb` type is gone).~~ **Done** — `Page()` composes the
trail and `interface Crumb` is declared next to `useCrumbs`. The composition carries
`data-testid="breadcrumb"`, the joined `data-trail`, and an indexed
`breadcrumb-item-${index}` per crumb (§26.4). No crumb is a `BreadcrumbLink`: two of the
three name no route — the console has no page for "the site context" — and the third is
the page already open, so a link there could only leave a half-filled form or change the
site. Exactly one crumb is a `BreadcrumbPage`, the last, because that part carries
`aria-current="page"` and three of them announce three current pages.

**Re-vendored 2026-07-31.** The `git reset --hard` put the old `items`-taking
`breadcrumb.tsx` back; `npx shadcn@latest add breadcrumb --overwrite` restored the
compound file. It still contains zero `data-testid`, which is the point of §26.4.

---

## 9. collapsible

`docs …/radix/collapsible` · `api https://www.radix-ui.com/docs/primitives/components/collapsible.md`

**Exports** `Collapsible, CollapsibleTrigger, CollapsibleContent`. Thin Radix
pass-throughs with **zero styling** — no animation classes are applied, so add your own
`data-open:animate-*` / `overflow-hidden` when you want one.

`Collapsible`: `open`, `defaultOpen`, `onOpenChange`, `disabled`, `asChild`.
`CollapsibleTrigger`: `asChild`. `CollapsibleContent`: `forceMount`, `asChild`.

Collapsible sidebar group (the pattern the docs point at):

```tsx
<Collapsible defaultOpen className="group/collapsible">
  <SidebarGroup>
    <SidebarGroupLabel asChild>
      <CollapsibleTrigger data-testid="ck-nav-content-toggle">
        Content
        <ChevronDownIcon className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-180" />
      </CollapsibleTrigger>
    </SidebarGroupLabel>
    <CollapsibleContent>
      <SidebarGroupContent><SidebarMenu>…</SidebarMenu></SidebarGroupContent>
    </CollapsibleContent>
  </SidebarGroup>
</Collapsible>
```

---

## 10. tooltip

`docs …/radix/tooltip` · `api https://www.radix-ui.com/docs/primitives/components/tooltip.md`

**Exports** `Tooltip, TooltipContent, TooltipProvider, TooltipTrigger`.

**`Tooltip` has no `content` prop.** The old hand-rolled one did
(`forms/fields/scopes.tsx:82`, `forms/fields/map.tsx:198`). Replacement:

```tsx
// old
<Tooltip content="You do not hold this scope yourself" className="block">{chip}</Tooltip>

// new
<Tooltip>
  <TooltipTrigger asChild>{chip}</TooltipTrigger>
  <TooltipContent>You do not hold this scope yourself</TooltipContent>
</Tooltip>
```

- `TooltipProvider` is **required** somewhere above (once, at the app root). Installed
  default `delayDuration = 0`; also takes `skipDelayDuration`,
  `disableHoverableContent`.
- `Tooltip` (Root): `open`, `defaultOpen`, `onOpenChange`, `delayDuration`,
  `disableHoverableContent`.
- `TooltipTrigger`: `asChild`. The trigger must be focusable — wrapping a disabled
  button silently kills the tooltip; wrap a `span` instead.
- `TooltipContent`: Radix Content — `side`, `align`, `sideOffset` (**default `0` here,
  not 4**), `alignOffset`, `avoidCollisions`, `collisionPadding`, `hidden`, `forceMount`.
  It portals itself and **always renders a `TooltipPrimitive.Arrow`** — do not add one.
  Max width is `max-w-xs`; it is `bg-foreground text-background` (inverted), so never
  set colours on it.
- `className="block"` from the old call sites belongs on the trigger element now, not on
  `Tooltip` (the Root renders no DOM node).

---

## 11. hover-card

`docs …/radix/hover-card` · `api …/components/hover-card.md`

**Exports** `HoverCard, HoverCardTrigger, HoverCardContent` — that is all; there is no
`HoverCardPortal`/`HoverCardArrow` export (Content portals itself, no arrow).

`HoverCard`: `open`, `defaultOpen`, `onOpenChange`, `openDelay`, `closeDelay`.
`HoverCardTrigger`: `asChild`.
`HoverCardContent`: Radix Content; installed defaults `align="center"`,
`sideOffset={4}`; width `w-64` (override with `className`).

Pointer-only by design — never put required information behind it, and never use it
where `Tooltip` (keyboard-reachable) is the right control.

---

## 12. popover

`docs …/radix/popover` · `api …/components/popover.md`

**Exports** `Popover, PopoverAnchor, PopoverContent, PopoverDescription, PopoverHeader,
PopoverTitle, PopoverTrigger`. `PopoverHeader`/`PopoverTitle`/`PopoverDescription` are
`radix-nova` extras — use them instead of hand-rolled headings.

`Popover`: `open`, `defaultOpen`, `onOpenChange`, `modal`.
`PopoverTrigger`: `asChild`.
`PopoverContent`: Radix Content; installed defaults `align="center"`, `sideOffset={4}`,
side defaults to `"bottom"`. Base classes: `w-72 flex flex-col gap-2.5 p-2.5
bg-popover shadow-md ring-1`. It portals itself; do not add a Portal or a z-index.
`PopoverTitle` renders a `<div>` (despite the `"h2"` prop type).

For a Calendar inside, kill the padding: `<PopoverContent className="w-auto p-0">`.
Calendar already detects `in-data-[slot=popover-content]` and drops its own background.

---

## 13. sheet

`docs …/radix/sheet` · `api …/components/dialog.md` (Sheet is Radix Dialog)

**Exports** `Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter,
SheetTitle, SheetDescription`. Note the asymmetry with Dialog: **`SheetPortal` and
`SheetOverlay` are defined but NOT exported** — `SheetContent` renders both.

`SheetContent` props: Radix Content **plus `side?: "top" | "right" | "bottom" | "left" =
"right"`** and **`showCloseButton?: boolean = true`**. Sizing is
`data-[side=right]:w-3/4 data-[side=right]:sm:max-w-sm` (same for left); top/bottom are
`h-auto`. There is no `size` prop.

`SheetTitle` is required (Radix warns without it) — `className="sr-only"` when the
design has no visible heading, as `ui/sidebar.tsx` itself does.

`SheetContent`'s close button carries a derived `data-testid` for the same reason
`DialogContent`'s does (§4): `<SheetContent data-testid="x">` → `x-close`, and
`sheet-close` when the panel has no id. The only `SheetContent` in this project is the
mobile sidebar, which hides that button with `[&>button]:hidden` — the id is there so the
next sheet does not have to remember.

---

## 14. data-table — a PATTERN, and react-table is NOT installed

`npx shadcn@latest docs data-table` →
`Component data-table not found in the shadcn registry.`
The doc page (`…/radix/data-table`) says it outright: *"So instead of a data-table
component, I thought it would be more helpful to provide a guide on how to build your
own."* Its install steps are `npx shadcn@latest add table` **and**
`npm install @tanstack/react-table`, and it builds on `Table`, `Button`, `Checkbox`,
`Input`, `DropdownMenu` with `useReactTable`, `getCoreRowModel`, `ColumnDef`,
`flexRender`, `getSortedRowModel`, `getFilteredRowModel`, `getPaginationRowModel`.

**`@tanstack/react-table` is NOT installed** — it is absent from
`apps/cockpit/package.json` and there is no `node_modules/@tanstack/react-table`. **Do
not install it.** No `useReactTable`/`ColumnDef`/`flexRender` code can be written here.

`src/components/ui/data-table.tsx` is **not** a shadcn file. It is the console's own
capability-driven table: `useTableView`, `DataTable`, `ColumnChooser`,
`DataColumn<Row>`, `TableView`, re-exporting `firstPage`. It is built on
`@/lib/table-view`, `@/lib/cursor`, `@tanstack/react-router` and `./pagination`.

> **Corrected 2026-07-30.** This section used to say it was built on the hand-rolled
> `Table/THead/TBody/TR/TH/TD/TableState` in `./primitives`, "**not** on `ui/table.tsx`",
> and that its one break was `SkeletonRows`. Both statements are now false.
> `ui/primitives.tsx` is **deleted**; the markup is `Table/TableHeader/TableBody/
> TableRow/TableHead/TableCell` from `ui/table.tsx`, the four states are `TableState`
> from `@/forms/table-state`, and `SkeletonRows` is a real export of `ui/skeleton.tsx`
> (a local helper on top of shadcn's `Skeleton`, as §20 anticipated) built on
> `TableRow`/`TableCell` from `ui/table.tsx`. The four-state discipline survived and got
> sharper: loading is `Skeleton` rows, **error is `Alert variant="destructive"`**, empty
> is `Empty` + `EmptyMedia variant="icon"` — three different components, so no two
> states can be mistaken for each other. Guarded by
> `test/unit/cockpit-one-stack.test.mjs`.

---

## 15. calendar (+ the DatePicker composition) — **REMOVED FROM THIS PROJECT**

> **Decision, 2026-07-30.** `ui/calendar.tsx` is deleted and `react-day-picker` and
> `date-fns` are out of `package.json`. The component was imported by nothing, and the
> alternative — composing Popover + Calendar into `forms/fields/date.tsx` — was declined:
> `forms/fields/date-value.ts` keeps a calendar day a calendar day with string
> arithmetic and no `Date` in local time (proven in three time zones by
> `test/unit/cockpit-dates-progress.test.mjs`), while react-day-picker selects and
> reports local `Date` objects and would put a second, differently-reasoned conversion in
> front of the one that is proven. `<input type="date">` already opens the platform's own
> calendar, is localised, and is reachable by keyboard everywhere. The ban list in that
> test now names `react-day-picker` and `date-fns` again, and asserts the file is gone.
> The section below is kept as the API record, in case the decision is ever revisited.

`docs …/radix/calendar` · `api https://react-day-picker.js.org` ·
date-picker doc: `…/radix/date-picker`

**Exports** `Calendar, CalendarDayButton`. **There is no `DatePicker` component** — the
date-picker page states it plainly: *"there is no `DatePicker` root component"*. It is
Popover + Calendar:

```tsx
<Field>
  <FieldLabel htmlFor="publish-at">Publish at</FieldLabel>
  <Popover>
    <PopoverTrigger asChild>
      <Button id="publish-at" variant="outline" data-testid="ck-publish-at-trigger">
        <CalendarIcon data-icon="inline-start" />
        {date ? date.toLocaleDateString(undefined, { dateStyle: "long" }) : "Pick a date"}
      </Button>
    </PopoverTrigger>
    <PopoverContent className="w-auto p-0">
      <Calendar mode="single" selected={date} onSelect={setDate} captionLayout="dropdown"
                data-testid="ck-publish-at-calendar" />
    </PopoverContent>
  </Popover>
</Field>
```

Range: same shell, `mode="range" numberOfMonths={2}` and `DateRange { from, to }` state.
Date + time: the same Popover picker plus a sibling `<Input type="time">` in the same
`FieldGroup`.

**What react-day-picker v10 expects** (neither it nor `date-fns` is installed any more —
this is the API record for a future `shadcn add calendar`, verified against v10 while it
briefly was):

- `mode`: `"single" | "multiple" | "range"`; `selected` / `onSelect`; `required` narrows
  `onSelect`'s argument to non-`undefined`.
- Month bounds are **`startMonth` / `endMonth`** (`Date`). `fromDate`, `toDate`,
  `fromYear`, `toYear`, `fromMonth`, `toMonth` are **v8 names and no longer exist**.
- `captionLayout`: `"label" | "dropdown" | "dropdown-months" | "dropdown-years"`
  (installed default `"label"`). `dropdown*` needs `startMonth`/`endMonth` to know the
  range to offer.
- `classNames` keys are **snake_case** (`month_grid`, `month_caption`, `day`,
  `day_button`, `button_previous`, `range_start`, `week_number`, …) and merge with
  `getDefaultClassNames()`. `components` override keys are **PascalCase** (`Root`,
  `Chevron`, `DayButton`, `WeekNumber`, `MonthCaption`, `Dropdown`, …). The installed
  `Calendar` already overrides `Root`, `Chevron`, `DayButton`, `WeekNumber` and merges
  anything you pass on top.
- `modifiers` on `DayButton` are `selected`, `focused`, `range_start`, `range_middle`,
  `range_end`, `today`, `outside`, `disabled`, `hidden`.
- Other props in play: `showOutsideDays` (installed default `true`), `numberOfMonths`,
  `defaultMonth`, `month`/`onMonthChange`, `disabled` (matcher or matcher[]),
  `fixedWeeks`, `showWeekNumber`, `locale` (a date-fns `Locale`), `formatters`, `dir`.
- shadcn-only prop: **`buttonVariant`** (`ButtonProps["variant"]`, default `"ghost"`) for
  the nav arrows.
- Sizing knobs are CSS vars on the root: `--cell-size: --spacing(7)` and
  `--cell-radius: var(--radius-md)` — resize via `className="[--cell-size:--spacing(9)]"`,
  never by restyling cells.

**Do not format dates with `date-fns`** even though the docs examples do — see §26.1.
Use `Intl` / `toLocaleDateString` (which is also what `CalendarDayButton` and
`formatMonthDropdown` already do internally, via `locale?.code`).

---

## 16. empty

`docs …/radix/empty`

**Exports** `Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent,
EmptyMedia`. There is **no `EmptyIcon` and no `EmptyAction`** — the icon is
`EmptyMedia variant="icon"` and actions go in `EmptyContent`.

```tsx
<Empty className="border" data-testid="ck-sites-empty">
  <EmptyHeader>
    <EmptyMedia variant="icon"><LayoutGridIcon /></EmptyMedia>
    <EmptyTitle>No sites yet</EmptyTitle>
    <EmptyDescription>A site is the unit ContentKit publishes. Create the first one.</EmptyDescription>
  </EmptyHeader>
  <EmptyContent>
    <Button size="sm" onClick={create} data-testid="ck-sites-empty-create">
      <PlusIcon data-icon="inline-start" />
      New site
    </Button>
  </EmptyContent>
</Empty>
```

- `EmptyMedia` `variant`: `"default" | "icon"` (default `"default"`). Its `data-slot` is
  **`empty-icon`**, not `empty-media` — relevant if you write a `has-data-[slot=…]`
  selector.
- **Gotcha:** `Empty`'s base classes include `border-dashed` but **no border width**, so
  no border renders unless you add `border` yourself. Both the docs example and this
  project's intent want the dashed frame → add `className="border"`.
- `Empty` is `flex-1`, so it fills its flex parent; inside a fixed-height card give the
  parent `flex`.
- `EmptyDescription` renders a `<div>` despite its `"p"` prop type — don't nest a `<p>`
  around it.
- Replaces the local `ui/empty-state.tsx` at every call site.

---

## 17. alert

`docs …/radix/alert`

**Exports** `Alert, AlertTitle, AlertDescription, AlertAction` (`AlertAction` is a
`radix-nova` extra).

```
Alert > <Icon> + AlertTitle + AlertDescription + AlertAction
```

- `Alert` `variant`: **`"default" | "destructive"` only.** There is no `warning`,
  `success`, `info`, or `tone` variant. The docs show amber alerts done with `className`
  utilities — which this project forbids (colour via className). Route non-destructive
  severity through `variant="default"` + an icon, or add a variant in `ui/alert.tsx`
  using ContentKit's existing tokens (that file's owner, not this document).
- **The icon must be a direct child of `Alert`,** before `AlertTitle`: the CVA switches
  to `has-[>svg]:grid-cols-[auto_1fr]` and `*:[svg]:row-span-2`. An icon nested in a
  `<span>` breaks the grid.
- `AlertAction` is `absolute top-2 right-2`; `Alert` reserves `pr-18` when one is
  present (`has-data-[slot=alert-action]`).
- `variant="destructive"` is `bg-card text-destructive` — a tinted text treatment, not a
  filled red banner.
- `Alert` sets `role="alert"` itself.

---

## 18. field

`docs …/radix/field`

**Exports** `Field, FieldLabel, FieldDescription, FieldError, FieldGroup, FieldLegend,
FieldSeparator, FieldSet, FieldContent, FieldTitle`.

```tsx
<FieldGroup>
  <Field>
    <FieldLabel htmlFor="name">Full name</FieldLabel>
    <Input id="name" data-testid="ck-site-name" />
    <FieldDescription>Shown in the site list and in release notes.</FieldDescription>
  </Field>

  <Field data-invalid>
    <FieldLabel htmlFor="slug">Slug</FieldLabel>
    <Input id="slug" aria-invalid data-testid="ck-site-slug" />
    <FieldError>Enter a lowercase slug.</FieldError>
  </Field>

  <Field orientation="horizontal">
    <FieldLabel htmlFor="feedback">Feedback widget</FieldLabel>
    <Switch id="feedback" data-testid="ck-site-feedback" />
  </Field>
</FieldGroup>
```

- `Field` `orientation`: `"vertical" | "horizontal" | "responsive"` (default
  `"vertical"`). `responsive` flips at the `@md/field-group` container query, so it only
  works inside a `FieldGroup`.
- **Validation is exactly two attributes:** `data-invalid` on `Field` (the CVA reads
  `data-[invalid=true]`; bare `data-invalid` in JSX serialises to `"true"`) and
  `aria-invalid` on the control. There is no `invalid` or `error` prop on `Field`.
- `FieldError` — `children` **or** `errors?: Array<{ message?: string } | undefined>`
  (one message → plain text, several → a `<ul>`). Returns `null` when there is nothing
  to show, and renders `role="alert"`.
- `FieldSet > FieldLegend > FieldDescription > FieldGroup` for grouped controls.
  `FieldLegend` `variant`: `"legend" | "label"` (default `"legend"`).
- `FieldContent` + `FieldTitle` for the checkbox/switch row where the label text is a
  block, not a `<label>`. Quirk: **`FieldTitle` renders `data-slot="field-label"`**, the
  same slot as `FieldLabel` — deliberate (the orientation CVA targets that slot) but
  confusing in a selector.
- `FieldLabel` is a real `Label` — it needs `htmlFor`, or it must wrap the control.
- No `required` prop on `FieldLabel`; mark it in the label text or the description.
- Sequencing matters: `FieldDescription` has `last:mt-0 nth-last-2:-mt-1` rules, so keep
  the order label → control → description → error.

---

## 19. input-group

`docs …/radix/input-group`

**Exports** `InputGroup, InputGroupAddon, InputGroupButton, InputGroupText,
InputGroupInput, InputGroupTextarea`.

```tsx
<InputGroup>
  <InputGroupInput placeholder="Search content…" data-testid="ck-content-search" />
  <InputGroupAddon><SearchIcon /></InputGroupAddon>
  <InputGroupAddon align="inline-end">
    <InputGroupButton size="icon-xs" onClick={clear} data-testid="ck-content-search-clear">
      <XIcon />
    </InputGroupButton>
  </InputGroupAddon>
</InputGroup>
```

- The control **must** be `InputGroupInput` / `InputGroupTextarea` (they carry
  `data-slot="input-group-control"`, which every focus/invalid selector on the wrapper
  keys off). A raw `Input` inside `InputGroup` renders but loses the focus ring and the
  invalid ring.
- `InputGroupAddon` `align`: `"inline-start" | "inline-end" | "block-start" |
  "block-end"` (default `"inline-start"`). `block-*` makes the group `h-auto flex-col`.
- **`InputGroupButton` `size`: `"xs" | "sm" | "icon-xs" | "icon-sm"` (default `"xs"`)** —
  its type is `Omit<ButtonProps, "size">`, so Button sizes `default`, `lg`, `icon`,
  `icon-lg` **do not typecheck here**. Default `variant="ghost"`, `type="button"`.
- `InputGroupAddon` installs its own `onClick` that focuses the sibling input; because
  `{...props}` is spread **after** it, passing your own `onClick` replaces that
  behaviour. Wrap real buttons in `InputGroupButton` (its handler short-circuits on
  `closest("button")`).
- `InputGroup` is `h-8` and auto-grows only for textareas and `block-*` addons.
- `InputGroupText` is the only part without a `data-slot`.

---

## 20. skeleton

`docs …/radix/skeleton`

**Exports `Skeleton`. That is the entire API** — `className` + `div` props, base
`animate-pulse rounded-md bg-muted`.

`SkeletonRows`, `SkeletonGroup`, `SkeletonFields`, `SkeletonText` do not exist **in the
registry payload**.

> **Corrected 2026-07-30.** This paragraph used to end "…and are imported today by
> `ui/data-table.tsx`, `ui/release-chain.tsx`, `pages/overview.tsx`, `pages/content.tsx`"
> as an open break. It is not one any more: the second option it offered was taken.
> `ui/skeleton.tsx` exports `Skeleton, SkeletonFields, SkeletonGroup, SkeletonRows,
> SkeletonText` — the four extras are local helpers **on top of** shadcn's `Skeleton`, in
> the file that owns it, and `SkeletonRows` builds on `TableRow`/`TableCell` from
> `ui/table.tsx`. Nothing hand-rolls a pulse; `test/unit/cockpit-one-stack.test.mjs`
> fails the whole tree on a stray `animate-pulse` outside `skeleton.tsx` and
> `progress.tsx`. A future `shadcn add skeleton` would overwrite all four — same hazard
> as `progress` (§21), for the same reason.

Per house rules: never a hand-written `animate-pulse` div. Also available:
`SidebarMenuSkeleton showIcon` for nav rows (§6).

---

## 21. progress

`docs …/radix/progress` · `api …/components/progress.md`

> **This project's `ui/progress.tsx` is no longer the stock file** (2026-07-30). It keeps
> the whole ContentKit contract — `value`, `max`, `label`, `valueLabel`, `tone`
> (`accent | warning | danger`, painted with `bg-accent` / `bg-chart-3` / `bg-chart-5`),
> `since`, `data-testid` — **on top of** Radix's Progress rather than instead of it:
>
> - The fraction is decided first, in `ui/progress-value.ts` (`progressPercent(value,
>   max)` → `number | null`), which is dependency-free so a unit test can call it. Absent
>   value, or a denominator that is absent/null/zero/negative, is `null`. `max` defaults
>   to 100, i.e. "value is already a percentage".
> - **Determinate** → Radix's `Root` with `value={percent} max={100}`; Radix owns all the
>   ARIA and nothing is restated.
> - **Indeterminate** → *not* Radix's root, deliberately: its root emits
>   `role="progressbar"`, `aria-valuemin` **and** `aria-valuemax` unconditionally (see
>   `@radix-ui/react-progress`, which drops only `aria-valuenow`), so a valueless bar
>   still reports a maximum for a quantity nobody measured. Instead: a pulsing track with
>   `role="progressbar"` and **no** `aria-value*` at all, plus `since` rendered through
>   `RelativeTime`. Pinned by `test/unit/cockpit-dates-progress.test.mjs`.
>
> Stock shadcn's file is described below; the two paragraphs that follow are still true
> *of Radix*, which is why the wrapper exists.

**Exports `Progress`.** Stock props: `value`, `max`, `getValueLabel`, `className`, `id`,
plus Radix Root props and `ref`.

**Props that do NOT exist in stock: `label`, `valueLabel`, `tone`, `since`.** The docs
are explicit: no label prop (use `Field`/`FieldLabel`), no `tone`, no `since`, no
indeterminate state — which is exactly what the wrapper above restores.

**Two behaviours you must know before rewriting the call sites:**

1. The indicator is `style={{ transform: 'translateX(-' + (100 - (value||0)) + '%)' }}`
   — **`value` is consumed as a percentage and `max` is ignored visually.** `max` still
   reaches Radix for `aria-valuemax`. So `value={used} max={budget}` renders wrong; pass
   `value={Math.round((used / budget) * 100)} max={100}` (or compute the percent and
   supply `getValueLabel`).
2. `value={null}` (Radix's indeterminate) renders a static empty bar — there is no
   indeterminate animation. So `since` has **no equivalent**.

Replacement for `pages/authoring.tsx:978` (label + valueLabel + tone + value/max):

```tsx
<Field data-testid="audio-budget">
  <FieldLabel htmlFor="audio-budget-bar">Characters used this month</FieldLabel>
  <Progress
    id="audio-budget-bar"
    value={Math.min(100, Math.round((budget.used / budget.budget) * 100))}
    max={100}
    getValueLabel={(v) => `${v}%`}
  />
  <FieldDescription>
    {budget.used.toLocaleString()} of {budget.budget.toLocaleString()} ·{" "}
    {budget.remaining.toLocaleString()} left
  </FieldDescription>
</Field>
```

`tone` has a home again (see the box at the top of this section) and paints the indicator
with the palette's own tokens. `pages/authoring.tsx` carries the severity in an adjacent
`Badge` instead, which is equally fine — the escalation is `lib/audio-budget.ts`'s
decision either way, and never a colour via `className`.

Replacement for `pages/releases.tsx` (`label` + `since`, an elapsed-time bar with no
percentage): **stock** `Progress` cannot express this; the wrapper can.

> **Corrected 2026-07-30.** This passage used to say `releases.tsx` "nonetheless stays on
> `Spinner` + the elapsed text" and printed a `<div className="flex …"><Spinner/>…</div>`
> as the shape to write. That is **not** what the page does, and the shape was wrong on
> its own terms: a plain `div` (and the `role="status"` it briefly carried) makes no claim
> about progress at all, so an operator who reaches the card after the announcement has
> passed is told there is a paragraph, not that a build is in flight. The page composes
> the wrapper, and the indeterminate `role="progressbar"` is asserted twice — in
> `src/components/ui/progress.test.tsx` against the component and in
> `src/pages/releases.test.tsx` against the page as it actually renders:

```tsx
<Progress
  data-testid="release-build-progress"
  label={inFlight === 1 ? 'Building' : `Building ${inFlight} at once`}
  since={startedAt}
  // Spelled out for the test id alone: `release-build-since` is the name a
  // browser test already knows the elapsed time by, and `Progress` would
  // otherwise derive `-progress-value`. Same component, same sentence.
  valueLabel={<RelativeTime value={startedAt} data-testid="release-build-since" />}
/>
```

The paragraph beneath it still says the readout is elapsed time and not a percentage,
which is why no *determinate* bar belongs here either.

---

## 22. spinner

`docs …/radix/spinner`

**Exports `Spinner`.** Stock: it **is** the icon — `Loader2Icon` with
`data-slot="spinner"`, `role="status"`, `aria-label="Loading"`,
`className="size-4 animate-spin"`, typed `React.ComponentProps<"svg">`. No `size` prop,
no `variant` — resize with `size-*`.

> **This project's `ui/spinner.tsx` has the two forms back** (2026-07-30), because stock's
> single form announces "Loading" next to a button that already says `Revoke key`:
>
> - `<Spinner />` (no `label`, no `aria-label`) — one `Loader2Icon`, `aria-hidden`,
>   silent. This is the in-button form and the default.
> - `<Spinner label="Loading this page…" />` (or an `aria-label`, treated as the same
>   claim) — wrapped in a `role="status"` span with the sentence in `sr-only` text.
>   `pagination.tsx` uses the `aria-label` spelling.
>
> Plus `size`: `sm | default | lg` → `size-3 | size-4 | size-6`, and `data-testid`
> (default `ck-spinner`) on whichever element is outermost. Still one `Loader2Icon` in the
> file. Pinned by `test/unit/cockpit-primitives.test.mjs`.

Loading button — the only sanctioned shape (`Button` has no `isPending`/`loading`):

```tsx
<Button size="sm" disabled={save.isPending} data-testid="ck-save">
  {save.isPending && <Spinner data-icon="inline-start" />}
  Save
</Button>
```

`data-icon="inline-start"` (or `inline-end`) drives the Button CVA's padding; do **not**
add a size class to the Spinner inside a Button.

---

## 23. sonner

`docs …/radix/sonner` · `api https://sonner.emilkowal.ski` (sonner 2.0.7)

**Exports `Toaster`** from `@/components/ui/sonner`; the imperative `toast` comes from
**`"sonner"`** directly. `<Toaster />` is mounted once at the app root by `ToastProvider`
in `components/ui/toast.tsx` (§1) — do not mount a second one.

```tsx
import { toast } from "sonner"

toast("Release queued.")
toast.success("Site published", { description: "example.test · release 4.3.3" })
toast.error("Publish failed", { action: { label: "Retry", onClick: retry } })
toast.warning("Unsaved changes")
toast.info("Preview expires in 10 minutes")
toast.loading("Rendering…")
toast.promise(publish(), { loading: "Publishing…", success: "Published", error: "Failed" })
```

Options: `description`, `action: { label, onClick }`, `cancel`, `duration`, `id`,
`position`, `dismissible`, `icon`. `Toaster` takes all sonner `ToasterProps`
(`position`, `richColors`, `closeButton`, `expand`, `visibleToasts`, `toastOptions`, …).

Installed specifics: the local `Toaster` already supplies lucide `icons` for
success/info/warning/error/loading and maps sonner's CSS vars onto ContentKit's tokens
(`--normal-bg: var(--popover)` etc.), and sets `toastOptions.classNames.toast =
"cn-toast"`. Because `{...props}` is spread **last**, passing your own `toastOptions`
**replaces** that class — merge rather than override. That same spread ordering is what
makes the next-themes problem harmless: `ui/sonner.tsx` does read `useTheme` from
`next-themes`, which this project does not use, but `ToastProvider` passes
`theme={resolved}` from `@/lib/theme` and the caller's value lands after sonner's. Do not
"tidy" `{...props}` to the front (§1).

---

## 24. dropdown-menu

`docs …/radix/dropdown-menu` · `api …/components/dropdown-menu.md`

**Exports** `DropdownMenu, DropdownMenuPortal, DropdownMenuTrigger,
DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuItem,
DropdownMenuCheckboxItem, DropdownMenuRadioGroup, DropdownMenuRadioItem,
DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubTrigger,
DropdownMenuSubContent`.

```
DropdownMenu > DropdownMenuTrigger(asChild)
             > DropdownMenuContent > DropdownMenuLabel
                                   > DropdownMenuGroup > DropdownMenuItem
                                                       > DropdownMenuShortcut (inside the item)
                                   > DropdownMenuSeparator
                                   > DropdownMenuRadioGroup > DropdownMenuRadioItem
                                   > DropdownMenuSub > DropdownMenuSubTrigger
                                                     > DropdownMenuSubContent
```

- `DropdownMenuContent` — Radix Content; installed defaults **`align="start"`** (not
  `center`) and `sideOffset={4}`; it portals itself, and its width is
  `w-(--radix-dropdown-menu-trigger-width) min-w-32` — i.e. **it matches the trigger
  width by default**. Override with `className="w-56"` when the trigger is an icon
  button.
- `DropdownMenuItem` — Radix Item **plus `inset?: boolean`** and
  **`variant?: "default" | "destructive"`**.
- `DropdownMenuCheckboxItem` — `checked`, `onCheckedChange`, `inset`; renders its own
  right-aligned `CheckIcon` indicator. Do not add one.
- `DropdownMenuRadioItem` — `value`, `inset`; must sit in `DropdownMenuRadioGroup`
  (`value`/`onValueChange`).
- `DropdownMenuLabel` and `DropdownMenuSubTrigger` also take `inset`.
- `DropdownMenuShortcut` is a `<span>`; it goes *inside* the item.
- Items belong in a `DropdownMenuGroup` (house rule) — Radix uses it for grouping
  semantics.

---

## 25. toggle-group

`docs …/radix/toggle-group` · `api …/components/toggle-group.md`

**Exports** `ToggleGroup, ToggleGroupItem`.

```tsx
<ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v)}
             variant="outline" size="sm" spacing={0} data-testid="ck-view-toggle">
  <ToggleGroupItem value="list" aria-label="List" data-testid="ck-view-list">
    <ListIcon />
  </ToggleGroupItem>
  <ToggleGroupItem value="grid" aria-label="Grid" data-testid="ck-view-grid">
    <LayoutGridIcon />
  </ToggleGroupItem>
</ToggleGroup>
```

- `type` is **required** by Radix: `"single"` (`value: string`,
  `onValueChange(v: string)`) or `"multiple"` (`value: string[]`). In single mode
  deselecting yields `""`, hence the `v && …` guard.
- Also from Radix: `defaultValue`, `disabled`, `loop`, `rovingFocus`, `dir`.
- `variant`: **`"default" | "outline"`**. `size`: **`"default" | "sm" | "lg"`** (from
  `toggleVariants` in `ui/toggle.tsx` — there is no `xs` and no `icon*`).
- `spacing?: number = 2` — a shadcn extra; it becomes `--gap` and
  `gap-[--spacing(var(--gap))]`. **`spacing={0}` is the joined/segmented look** (items
  square up, first/last round, outline borders collapse). This is the replacement for the
  local `ui/segmented.tsx`.
- `orientation?: "horizontal" | "vertical" = "horizontal"` — a shadcn extra that also
  sets `data-orientation` and flips the flex direction.
- `ToggleGroupItem` takes `value`, `disabled`, plus `variant`/`size` which are
  **overridden by the group's context when the group sets them** (`context.variant ||
  variant`). Set them on the group.
- Always give an icon-only item an `aria-label`.
- `ToggleGroupItem` must be inside `ToggleGroup` (context), per house rule and by design.

---

## 26. Four contracts in the test suite that the plain shadcn files break — ✅ ALL FOUR ANSWERED

> **Corrected 2026-07-30.** This section used to open "…currently reports **893 pass / 4
> fail**". `node --test test/unit/*.test.mjs test/contract/*.test.mjs` now reports **940
> pass / 0 fail** on Node 22 (Node 20 is also 0 fail; seven cases self-skip there because
> type stripping only landed in 22.6 and they import cockpit `.ts` modules for real).
> All four contracts below were answered by keeping the component's promise, not by
> relaxing an assertion — except §26.4, where the assertion deliberately *moved* and got
> stronger. Each resolution is recorded in place.

All four were source-reading assertions about `apps/cockpit`, and all four failed
*because* a `ui/` file had been replaced with the stock shadcn version. The rule they
were answered under still stands: either the component keeps the contract, or the test is
deliberately changed **and then mutation-tested in the relaxing direction**.

### 26.1 `date-fns` is a banned dependency — and it is installed  ✅ RESOLVED 2026-07-30

**Resolution:** removed. `ui/calendar.tsx` is deleted and both `date-fns` and
`react-day-picker` are out of `package.json` and `package-lock.json` — see the box in
§15 for why the Popover + Calendar composition was declined. The test now bans both
names *and* asserts `calendar.tsx` does not exist, and the import-level check covers
`react-day-picker` too.


`test/unit/cockpit-dates-progress.test.mjs:562` — *"no library was added for a date or a
bar"*:

```js
const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })
for (const banned of ['date-fns', 'dayjs', 'luxon', 'moment', 'timeago.js', 'react-datepicker', 'rc-progress']) {
  assert.equal(names.includes(banned), false, `${banned}: Intl and <input type="date"> are already in the browser`)
}
```

`apps/cockpit/package.json` now lists `"date-fns": "^4.4.0"`. Failure text:

```
date-fns: Intl and <input type="date"> are already in the browser
```

`react-day-picker` is **not** on the ban list, so the Calendar itself is fine; only the
formatting library is. Nothing in `src/` needs `date-fns` — `ui/calendar.tsx` and
`ui/relative-time.tsx` both use `toLocaleDateString`/`Intl`. So either drop the
dependency, or the test's intent has to be renegotiated. **Do not write `format()` from
`date-fns` into any call site.**

### 26.2 Progress must be able to be indeterminate  ✅ RESOLVED 2026-07-30

**Resolution:** the contract is kept on top of Radix rather than by reverting — §21.
The indeterminate branch is not Radix's root (it emits `aria-valuemin`/`aria-valuemax`
unconditionally), so it is a pulsing `role="progressbar"` with no `aria-value*` at all;
the determinate branch is Radix's and restates none of its ARIA. The `fraction === null`
decision moved into `ui/progress-value.ts`, which a unit test calls for real.


`test/unit/cockpit-primitives.test.mjs:740` — *"an indeterminate bar reports no
percentage to anyone"* reads `ui/progress.tsx` and requires literally:

```
aria-valuenow={fraction === null ? undefined : …}   (same for aria-valuemin, aria-valuemax)
role="progressbar"
!(max > 0)          // zero, null and absent are all "not a denominator"
```

Failure text: `aria-valuenow must be absent while the fraction is unknown`.

Radix `Progress.Root` always emits `role="progressbar"` **and** `aria-valuemax`, and
emits `aria-valuenow` whenever `value` is a number — there is no `fraction === null`
branch in the file. This is the same gap as §21: the console has an
elapsed-time/unknown-fraction bar (`pages/releases.tsx` `since=`) that stock `Progress`
cannot express. Resolving it means either keeping a ContentKit `Progress` that satisfies
this contract or moving those call sites off a progressbar entirely (Spinner + elapsed
text, §21) and rewriting the test.

### 26.3 Skeleton must announce, Spinner must have two forms  ◐ SPINNER RESOLVED 2026-07-30

**Resolution (spinner half):** the two forms are back — §22. The icon is always
`aria-hidden` and the announcement is the caller's own sentence in an `sr-only` span, so
the in-button shape `<Spinner data-icon="inline-start" />` is silent by default and a
standalone spinner names what is loading. Still one `Loader2Icon`. The skeleton half is
`ui/skeleton.tsx`'s owner, not this one.


`test/unit/cockpit-primitives.test.mjs:756` — *"the skeleton announces once and the
spinner keeps the label"*:

```js
assert.match(ui('skeleton'), /role="status"/)      // stock Skeleton has neither
assert.match(ui('skeleton'), /aria-hidden="true"/)
const icons = openingTags(ui('spinner'), 'Loader2')
assert.equal(icons.length, 2, 'the spinner has a standalone form and an in-button form')
for (const icon of icons) assert.match(icon, /aria-hidden="true"/)
assert.match(ui('spinner'), /role="status"/)
```

Failure text: `a placeholder nobody is told about is a silent one`.

Stock `skeleton.tsx` is 13 lines with no ARIA at all. Stock `spinner.tsx` is one
`Loader2Icon` with `role="status" aria-label="Loading"` and **no** `aria-hidden` — so
inside a Button it gets announced alongside the label, which is exactly what this test
was written to prevent. Note the interaction with §22: the sanctioned in-button shape
(`<Spinner data-icon="inline-start" />`) needs an `aria-hidden` branch to satisfy this.

### 26.4 Breadcrumb must be addressable  ✅ RESOLVED 2026-07-30 — by moving the assertion

**Resolution:** the second option was taken, and it is the better one. Stock
`breadcrumb.tsx` still contains **zero** `data-testid` (verified: `grep -c data-testid
src/components/ui/breadcrumb.tsx` → `0`) and is left untouched, because a default id
baked into a generic part names the part rather than the trail. `app/shell.tsx` supplies
them at the composition instead, and the assertion moved there with them — where it now
checks two things the old one could not:

```js
assert.match(shell, /from '@\/components\/ui\/breadcrumb'/, 'the page header must render the breadcrumb')
assert.match(shell, /data-testid="breadcrumb"/, 'the composed trail must be addressable in the browser')
assert.match(shell, /data-testid=\{`breadcrumb-item-\$\{index\}`\}/)   // breadcrumb-item-0 is the context
```

This is **not** a relaxation: the old form was satisfied by any `data-testid=` anywhere in
`breadcrumb.tsx`, including on a part nobody renders; the new one names the trail *and*
requires every crumb to keep its index, which is what a browser test actually addresses.
The import-provenance half of the test is unchanged.

The standing user requirement (§2) is unaffected and still binding — see the
`dialog.tsx` / `sheet.tsx` note in §4 and §13 for the one place it was found unmet.

---

## 27. Every place the real API differs from a half-remembered one

The list this document exists for. Each row was verified in the installed source.

| # | Half-remembered | Actually |
| --- | --- | --- |
| 1 | `<Dialog title description footer size busy onClose>` | Compositional only: `Dialog > DialogContent > DialogHeader/DialogTitle/DialogDescription + DialogFooter`. None of those six props exist. §4 |
| 2 | `DialogActions` wraps footer buttons | Deleted. `DialogFooter` *is* the button row. |
| 3 | Wrap `DialogContent` in `DialogPortal` + `DialogOverlay` | `DialogContent` renders both itself. Wrapping double-portals it. |
| 4 | `DialogFooter` is a plain div | It also takes `showCloseButton` (default `false`) — a `radix-nova` extra. |
| 5 | `<Progress label valueLabel tone since>` | **Stock** takes only `value`, `max`, `getValueLabel`. This project's `ui/progress.tsx` is not stock and takes all four — do not "simplify" a call site to match the registry. §21 |
| 6 | `Progress` respects `max` visually | It does **not**: the indicator is `translateX(-(100 - value)%)`. `value` must already be a percentage. |
| 7 | `Progress` can be indeterminate | **Stock** cannot: `value={null}` renders a static empty bar that still reports `aria-valuemin`/`aria-valuemax`. This project's wrapper can, and `pages/releases.tsx` uses it — corrected 2026-07-30, this row used to end "Use `Spinner`". §21 |
| 8 | `<Tooltip content="…">` | `Tooltip > TooltipTrigger asChild + TooltipContent`. No `content` prop. §10 |
| 9 | `TooltipContent sideOffset` defaults to 4 | Installed default is **`0`**. It also always renders its own Arrow. |
| 10 | Tooltips work standalone | `TooltipProvider` is required — and `SidebarMenuButton tooltip=…` needs it too. Mounted once, as the outermost element of `Shell()` in `app/shell.tsx`; before that it was mounted nowhere and the sidebar threw. §1 |
| 11 | `CommandDialog` renders `Command` for you | It does **not**. You must nest `<Command>` inside. §7 |
| 12 | Add your own `DialogTitle` inside `CommandDialog` | It already renders an `sr-only` `DialogHeader` (outside `DialogContent`). Adding a second is a duplicate. |
| 13 | Add a `SearchIcon` next to `CommandInput` | `CommandInput` already wraps itself in `InputGroup` with a `SearchIcon` addon. |
| 14 | Hand-roll a check mark on a selected `CommandItem` | `CommandItem` appends its own `CheckIcon`, shown via `data-checked="true"` and auto-hidden when the item has a `CommandShortcut`. |
| 15 | `data-testid` on `CommandDialog` / `Sidebar` marks the visible thing | Both spread `...props` onto a wrapper (Dialog Root; desktop container / mobile `Sheet`). Put ids on the inner parts. |
| 16 | `useSidebar()` returns `{ open, toggle }` | `{ state, open, setOpen, openMobile, setOpenMobile, isMobile, toggleSidebar }` — and it **throws** outside `SidebarProvider`. §6 |
| 17 | Sidebar shortcut is ⌘⇧B, or configurable by prop | **⌘B / Ctrl+B, no Shift**, from the module constant `SIDEBAR_KEYBOARD_SHORTCUT = "b"`. No prop. |
| 18 | `collapsible="icon"` is a persistent mode attribute | `data-collapsible` is set **only while collapsed**, so `group-data-[collapsible=icon]:*` is a state selector. |
| 19 | `SidebarMenu`/`SidebarMenuItem` are divs | `<ul>` / `<li>`. And `SidebarMenuSubButton` is an **`<a>`**, not a button. |
| 20 | `SidebarMenuSubButton size="default"` | Its sizes are `"sm" \| "md"`, default `"md"`. |
| 21 | `SidebarSeparator` doesn't exist (docs list omits it) | It **is** exported. So are `SidebarInput` and `SidebarGroupContent`. |
| 22 | `Sidebar` renders a sidebar on mobile | Below 768px it renders a **`Sheet`** with its own `sr-only` title. |
| 23 | `<Breadcrumb items={crumbs}/>`, `Crumb` type | Fully compositional; no `items`, no exported `Crumb`. Separators are hand-written and never auto-inserted. §8 |
| 24 | `BreadcrumbSeparator` is a span inside `BreadcrumbItem` | It is an **`<li>`** — a direct child of `BreadcrumbList`, a sibling of the items. |
| 25 | `Empty` shows a dashed frame | It sets `border-dashed` with **no border width** — add `className="border"`. §16 |
| 26 | `EmptyIcon` / `EmptyAction` | Neither exists. `EmptyMedia variant="icon"` and `EmptyContent`. `EmptyMedia`'s slot is `empty-icon`. |
| 27 | `Alert variant="warning" \| "success" \| "info"` | **Only `default` and `destructive`.** No `tone`. |
| 28 | An Alert icon can be nested | It must be a **direct child** of `Alert`, before `AlertTitle` (`has-[>svg]` grid). |
| 29 | `AlertAction` doesn't exist | It does (`radix-nova`), absolutely positioned top-right, with `pr-18` reserved. |
| 30 | `Field` takes `invalid` / `error` props | `data-invalid` on `Field` + `aria-invalid` on the control. Nothing else. §18 |
| 31 | `FieldError` needs children | It also accepts `errors?: Array<{message?: string}>` and returns `null` when empty. |
| 32 | `FieldLabel required` | No such prop. |
| 33 | `FieldTitle` has its own slot | It renders `data-slot="field-label"`, same as `FieldLabel`. |
| 34 | A raw `Input` works inside `InputGroup` | Use `InputGroupInput`/`InputGroupTextarea` — the wrapper's focus/invalid selectors key on `data-slot="input-group-control"`. §19 |
| 35 | `InputGroupButton size="icon"` | Its sizes are `"xs" \| "sm" \| "icon-xs" \| "icon-sm"` (Button's `size` is `Omit`ted). |
| 36 | `InputGroupAddon` is inert | It installs an input-focusing `onClick` that your own `onClick` silently replaces. |
| 37 | `data-table` is a component you can add | Not in the registry (`Component data-table not found`). It is a guide over `@tanstack/react-table`, **which is not installed here — do not install it.** §14 |
| 38 | `ui/data-table.tsx` is the shadcn data-table | It is the console's own cursor/capability table. Since 2026-07-30 it stands on `ui/table.tsx` + `@/forms/table-state`; `ui/primitives.tsx` is deleted. §14 |
| 38b | `ui/primitives.tsx` still exists | **Deleted 2026-07-30, restored by the reset, deleted again 2026-07-31 — this time with nothing importing it.** Its `Button/Card/Input/Textarea/Select/Label/Badge` are the shadcn files, its `Table/THead/TBody/TR/TH/TD` are `ui/table.tsx`, its `TableState` is `@/forms/table-state` (moved, not deleted — the four-state discipline is the point of it and `shadcn add table-state` has nothing to answer with), its `Badge tone=` is `@/forms/status-badge`. `ui/empty-state.tsx` went with it, replaced by `ui/empty.tsx`. One stack, guarded by `test/unit/cockpit-one-stack.test.mjs`. |
| 38c | one-stack grades the *specifier* a component was imported by | It grades the module that **declares** it, following `export … from`. That is what makes a barrel (`@/forms/fields`) not a finding and a laundering re-export (`export { Button } from './legacy'`) still one. It also reads `import Button from`, `import * as Ui from` and `import { Button as UiButton }` — a second stack arriving in any of those forms was invisible to the brace-only reader that shipped first. |
| 39 | `DatePicker` is a component | There is none — `Popover > PopoverTrigger asChild > Button` + `PopoverContent className="w-auto p-0" > Calendar`. §15 |
| 40 | Calendar bounds are `fromDate`/`toDate`/`fromYear`/`toYear` | react-day-picker v10 uses **`startMonth`/`endMonth`**; the v8 names are gone. |
| 41 | Calendar `classNames` keys are camelCase | **snake_case** (`month_grid`, `button_previous`, `range_start`, …); `components` keys are PascalCase. |
| 42 | Resize the calendar by styling cells | Set `--cell-size` (and `--cell-radius`) on the root. |
| 43 | `Calendar buttonVariant` is a react-day-picker prop | It is shadcn-only (default `"ghost"`). |
| 44 | `Skeleton` ships row/group/text helpers | The **registry** ships only `Skeleton`. This project's `ui/skeleton.tsx` exports `SkeletonRows`/`SkeletonGroup`/`SkeletonFields`/`SkeletonText` as local helpers on top of it (corrected 2026-07-30 — this row used to call them an open break). `shadcn add skeleton` would delete all four. §20 |
| 45 | `Spinner size="sm"` / `<Spinner/>` needs a wrapper | **Stock** *is* the svg (`Loader2Icon`, `role="status"`, `aria-label="Loading"`). This project's has `size` (`sm\|default\|lg`) and two forms, and the bare `<Spinner/>` is `aria-hidden`. §22 |
| 46 | `Button isPending` / `loading` | Neither exists: `Spinner` + `data-icon="inline-start"` + `disabled`. |
| 47 | `toast` comes from `@/components/ui/sonner` | `toast` from **`"sonner"`**; only `Toaster` is local. It **is** mounted (once, by `ToastProvider` in `ui/toast.tsx`) — corrected 2026-07-30. In this console you call `useToast().toast({ tone, title, detail })`, not sonner's methods. §23 |
| 48 | Passing `toastOptions` to `Toaster` merges | `{...props}` is spread last, so it **replaces** the local `classNames.toast = "cn-toast"`. |
| 49 | Local `Toaster` follows the app theme | `ui/sonner.tsx` does call `useTheme` from **next-themes**, which this project does not use (`lib/theme.ts`) — but `ToastProvider` passes `theme={resolved}` and `{...props}` is spread **after** sonner's own `theme=`, so the caller wins. Correct today; it breaks the moment someone moves that spread. §23 |
| 50 | `DropdownMenuContent align` defaults to `center`, width is content-driven | Installed default `align="start"`, and width is `w-(--radix-dropdown-menu-trigger-width) min-w-32` — it matches the trigger. §24 |
| 51 | `DropdownMenuItem` has no variants | `variant: "default" \| "destructive"` and `inset`. `Label`/`SubTrigger`/`CheckboxItem`/`RadioItem` take `inset` too. |
| 52 | Add a check icon to `DropdownMenuCheckboxItem` | It renders its own indicator. |
| 53 | `ToggleGroup` `type` is optional | Radix **requires** it; single-mode deselect yields `""`. §25 |
| 54 | `ToggleGroup size="xs"`, `variant="ghost"` | `variant: default \| outline`; `size: default \| sm \| lg`. |
| 55 | `spacing`/`orientation` are Radix props | Both are shadcn extras here. `spacing={0}` is the segmented look (replaces `ui/segmented.tsx`). |
| 56 | Per-item `variant`/`size` on `ToggleGroupItem` win | The group's context wins (`context.variant \|\| variant`). |
| 57 | `AlertDialogAction className={buttonVariants({variant:"destructive"})}` | It takes **`variant`/`size` directly** and wraps `Button asChild` internally. §5 |
| 58 | `AlertDialogContent` has no size | `size: "default" \| "sm"`; and `AlertDialogMedia` exists. |
| 59 | `SheetOverlay`/`SheetPortal` are exported like Dialog's | They are **not** — asymmetry with `dialog.tsx`. `SheetContent` renders both. §13 |
| 60 | `SheetContent size` | No `size`; `side: top\|right\|bottom\|left` (default `right`) + `showCloseButton` (default `true`). |
| 61 | `PopoverContent` has no header parts | `PopoverHeader`/`PopoverTitle`/`PopoverDescription`/`PopoverAnchor` are all exported. §12 |
| 62 | `Collapsible` animates out of the box | Zero styling — no animation, no `overflow-hidden`. Add your own. §9 |
| 63 | `base-ui`-style `render={<Link/>}` | This project is `base: radix` → **`asChild`**. Zero `render` props in the installed source. §0.1 |
| 64 | `@radix-ui/react-*` per-primitive imports | One package: `import { Dialog as DialogPrimitive } from "radix-ui"`; Slot is `Slot.Root`. |
| 65 | `data-[state=open]:` variants | `radix-nova` uses `data-open:` / `data-closed:` / `data-selected:` / `data-active:`. |
| 66 | `Button size="md"` | Sizes are `default \| xs \| sm \| lg \| icon \| icon-xs \| icon-sm \| icon-lg`. |
| 67 | The docs' `format(date, "PPP")` is fine | **`date-fns` is a banned dependency** in `cockpit-dates-progress.test.mjs:562`. It was installed for one afternoon and is now out of `package.json` and the lockfile. Use `Intl`. §26.1 |
| 68 | Stock `Progress` can express "unknown fraction" | `cockpit-primitives.test.mjs:740` requires an `aria-valuenow={fraction === null ? undefined : …}` branch that Radix Progress does not have. §26.2 |
| 69 | Stock `Skeleton`/`Spinner` are accessible enough | `cockpit-primitives.test.mjs:756` requires `role="status"` + `aria-hidden="true"` on Skeleton and **two** `aria-hidden` Loader2 forms on Spinner. Stock has neither. §26.3 |
| 70 | shadcn parts come with test ids | None of them do, and `ui/breadcrumb.tsx` still has zero — the assertion moved to the composition in `app/shell.tsx` instead (corrected 2026-07-30). The exceptions are `dialog.tsx`/`sheet.tsx`, whose close buttons now derive one from the panel's id. §26.4, §4 |
