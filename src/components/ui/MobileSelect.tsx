import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface MobileSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface MobileSelectProps {
  value: string;
  options: MobileSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  isEn?: boolean;
  disabled?: boolean;
}

// Multiple selects can overlap during parent updates. Only the final owner
// restores styles, including a scroll lock already held by a parent sheet.
const scrollLocks = new Map<HTMLElement, { count: number; value: string; priority: string }>();
function lockScroll(element: HTMLElement) {
  const existing = scrollLocks.get(element);
  if (existing) existing.count++;
  else {
    scrollLocks.set(element, {
      count: 1, value: element.style.getPropertyValue('overflow'),
      priority: element.style.getPropertyPriority('overflow'),
    });
    element.style.setProperty('overflow', 'hidden', 'important');
  }
  return () => {
    const lock = scrollLocks.get(element);
    if (!lock || --lock.count) return;
    scrollLocks.delete(element);
    // Do not overwrite a different overflow value installed by another modal.
    if (element.style.overflow !== 'hidden' || element.style.getPropertyPriority('overflow') !== 'important') return;
    if (lock.value) element.style.setProperty('overflow', lock.value, lock.priority);
    else element.style.removeProperty('overflow');
  };
}

/**
 * A native <select> cannot be restyled where it matters: on iOS/Android the
 * option list is drawn by the OS, so it ignores our font scale and opens
 * detached from the field (it can sit over unrelated content). This renders a
 * plain button plus a bottom sheet we fully control: 14px options, 48px rows,
 * and the list always anchored to the bottom of the viewport.
 *
 * Desktop keeps the native element — see SettingsPanel, which only swaps this
 * in for the mobile `sheet` variant.
 */
export const MobileSelect: React.FC<MobileSelectProps> = ({
  value,
  options,
  onChange,
  ariaLabel,
  isEn = false,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const listboxId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const current = options.find(option => option.value === value) ?? options[0];
  const enabled = options.filter(option => !option.disabled);
  const active = enabled.find(option => option.value === activeValue)
    ?? enabled.find(option => option.value === value) ?? enabled[0];
  const visible = open && !disabled;

  const focusOption = (nextValue: string | undefined) => {
    const option = [...(panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])]
      .find(button => button.dataset.value === nextValue && !button.disabled);
    (option ?? cancelRef.current)?.focus({ preventScroll: true });
    option?.scrollIntoView({ block: 'nearest' });
  };

  useLayoutEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useLayoutEffect(() => {
    if (!visible) return;
    const dialog = dialogRef.current!;
    const trigger = triggerRef.current;
    const unlockBody = lockScroll(document.body);
    const unlockRoot = lockScroll(document.documentElement);
    // Native modality makes the background inert without changing ancestors or
    // installing document key/focus handlers that compete with other sheets.
    dialog.showModal();
    focusOption(active?.value);
    return () => {
      const focused = document.activeElement;
      const ownedFocus = focused === document.body || dialog.contains(focused);
      dialog.close();
      unlockBody();
      unlockRoot();
      if (ownedFocus && trigger?.isConnected && !trigger.disabled) trigger.focus({ preventScroll: true });
    };
  }, [visible]);

  useLayoutEffect(() => {
    if (!visible) return;
    const focused = document.activeElement;
    // Repair a removed/disabled active option, but never pull focus out of a
    // different modal opened above this one, or away from the Cancel button.
    if (focused === dialogRef.current || focused === document.body
      || (focused instanceof HTMLElement && panelRef.current?.contains(focused)
        && (focused.getAttribute('role') !== 'option' || (focused as HTMLButtonElement).disabled))) {
      focusOption(active?.value);
    }
  });

  const openSheet = () => {
    if (disabled) return;
    setActiveValue(enabled.find(option => option.value === value)?.value ?? enabled[0]?.value ?? null);
    setOpen(true);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      // The listbox has one roving tab stop, alongside Cancel.
      if (document.activeElement === cancelRef.current && active) focusOption(active.value);
      else cancelRef.current?.focus({ preventScroll: true });
    } else if (event.target instanceof HTMLElement && event.target.getAttribute('role') === 'option'
      && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      const targetValue = (event.target as HTMLElement).dataset.value;
      const index = enabled.findIndex(option => option.value === targetValue);
      const next = event.key === 'Home' ? enabled[0] : event.key === 'End' ? enabled.at(-1)
        : enabled[(index + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length];
      if (next) {
        setActiveValue(next.value);
        focusOption(next.value);
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      // Keep native button activation (including Space keyup) inside the sheet.
      event.stopPropagation();
    }
  };

  const choose = (next: MobileSelectOption) => {
    if (disabled || next.disabled) return;
    onChange(next.value);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openSheet}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={visible}
        aria-controls={visible ? listboxId : undefined}
        aria-label={ariaLabel}
        className="flex h-11 w-full items-center justify-between gap-2 rounded-xl border border-purple-200 bg-purple-50/80 px-2.5 text-left text-sm font-bold text-purple-950 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-purple-400/40 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="truncate">{current?.label ?? ''}</span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-purple-600" />
      </button>

      {visible && (
        <dialog
          ref={dialogRef}
          aria-label={ariaLabel}
          aria-modal="true"
          onKeyDownCapture={onKeyDown}
          onKeyUp={event => event.stopPropagation()}
          onCancel={event => { event.preventDefault(); event.stopPropagation(); setOpen(false); }}
          className="fixed inset-0 z-[70] m-0 flex h-full max-h-none w-full max-w-none items-end justify-center border-0 bg-transparent p-0 text-inherit outline-none backdrop:bg-transparent"
        >
          <div
            className="absolute inset-0 bg-slate-900/40"
            onClick={event => { event.stopPropagation(); setOpen(false); }}
            aria-hidden="true"
          />
          <div
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            className="relative w-full max-w-md rounded-t-2xl bg-white pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-2xl outline-none"
          >
            <div className="flex items-center justify-between px-4 pb-2 pt-3">
              <span className="text-sm font-black text-purple-950">{ariaLabel}</span>
              <button
                ref={cancelRef}
                type="button"
                onClick={event => { event.stopPropagation(); setOpen(false); }}
                className="inline-flex h-11 min-w-11 items-center justify-center rounded-lg px-2 text-xs font-bold text-purple-600 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-purple-400"
              >
                {isEn ? 'Cancel' : '取消'}
              </button>
            </div>
            <div ref={panelRef} className="max-h-[60vh] overflow-y-auto overscroll-contain pb-1">
              {options.map(option => {
                const selected = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    aria-disabled={option.disabled || undefined}
                    disabled={option.disabled}
                    data-value={option.value}
                    tabIndex={option.value === active?.value && !option.disabled ? 0 : -1}
                    onFocus={() => setActiveValue(option.value)}
                    onClick={event => { event.stopPropagation(); choose(option); }}
                    className={`flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-purple-400 ${
                      selected
                        ? 'bg-purple-50 font-black text-purple-800'
                        : 'font-medium text-slate-700 active:bg-slate-100'
                    } ${option.disabled ? 'opacity-45' : ''}`}
                  >
                    <span className="truncate">{option.label}</span>
                    {selected && <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-purple-600" />}
                  </button>
                );
              })}
            </div>
          </div>
        </dialog>
      )}
    </>
  );
};
