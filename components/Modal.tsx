import React, { useEffect, useRef } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  labelledBy?: string;
  className?: string;
  /** When true, clicking the backdrop does not close the modal (use for in-progress/destructive flows that need an explicit choice). */
  disableBackdropClose?: boolean;
}

/**
 * Accessible modal shell: traps focus inside the dialog while open, restores
 * focus to the trigger element on close, and closes on Escape / backdrop click.
 * Pure presentation wrapper — no app state or business logic lives here.
 */
export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, children, labelledBy, className = '', disableBackdropClose }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocused.current = document.activeElement as HTMLElement;

    const focusableSelector = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const node = containerRef.current;
    const focusables = node ? Array.from(node.querySelectorAll<HTMLElement>(focusableSelector)) : [];
    (focusables[0] || node)?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab' && node) {
        const nodeList = node.querySelectorAll<HTMLElement>(focusableSelector);
        const items: HTMLElement[] = [];
        nodeList.forEach((el) => { if (el.offsetParent !== null) items.push(el); });
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused.current?.focus?.();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 dark:bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !disableBackdropClose) onClose();
      }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-slate-700 space-y-4 animate-in zoom-in-95 duration-150 outline-none ${className}`}
      >
        {children}
      </div>
    </div>
  );
};
