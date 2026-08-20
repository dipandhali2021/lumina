import React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Send, Square, X, Brain, Lock, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { type GenerateOptions } from '../lib/generate-options';
import { checkCoupon, savedCoupon, saveCoupon } from '../lib/coupon';

// Utility function for className merging
const cn = (...classes: (string | undefined | null | false)[]) =>
  classes.filter(Boolean).join(' ');

// Textarea Component
interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  className?: string;
}
const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn(
        'flex w-full rounded-md border-none bg-transparent px-3 py-2.5 text-base text-gray-100 placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50 min-h-[44px] resize-none',
        className,
      )}
      ref={ref}
      rows={1}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

// Tooltip Components
const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;
const TooltipContent = React.forwardRef<
  React.ComponentRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      'z-50 overflow-hidden rounded-md border border-[#333333] bg-[#1F2023] px-3 py-1.5 text-sm text-white shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
      className,
    )}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

// Dialog Components
const Dialog = DialogPrimitive.Root;
const DialogPortal = DialogPrimitive.Portal;
const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-[50%] top-[50%] z-50 grid w-full max-w-[90vw] md:max-w-[800px] translate-x-[-50%] translate-y-[-50%] gap-4 border border-[#333333] bg-[#1F2023] p-0 shadow-xl duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 rounded-2xl',
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 z-10 rounded-full bg-[#2E3033]/80 p-2 hover:bg-[#2E3033] transition-all">
        <X className="h-5 w-5 text-gray-200 hover:text-white" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      'text-lg font-semibold leading-none tracking-tight text-gray-100',
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

// Button Component
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    const variantClasses = {
      default: 'bg-white hover:bg-white/80 text-black',
      outline: 'border border-[#444444] bg-transparent hover:bg-[#3A3A40]',
      ghost: 'bg-transparent hover:bg-[#3A3A40]',
    };
    const sizeClasses = {
      default: 'h-10 px-4 py-2',
      sm: 'h-8 px-3 text-sm',
      lg: 'h-12 px-6',
      icon: 'h-8 w-8 rounded-full aspect-[1/1]',
    };
    return (
      <button
        className={cn(
          'inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

// ImageViewDialog Component
interface ImageViewDialogProps {
  imageUrl: string | null;
  onClose: () => void;
}
const ImageViewDialog: React.FC<ImageViewDialogProps> = ({
  imageUrl,
  onClose,
}) => {
  if (!imageUrl) return null;
  return (
    <Dialog open={!!imageUrl} onOpenChange={onClose}>
      <DialogContent className="p-0 border-none bg-transparent shadow-none max-w-[90vw] md:max-w-[800px]">
        <DialogTitle className="sr-only">Image Preview</DialogTitle>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="relative bg-[#1F2023] rounded-2xl overflow-hidden shadow-2xl"
        >
          <img
            src={imageUrl}
            alt="Full preview"
            className="w-full max-h-[80vh] object-contain rounded-2xl"
          />
        </motion.div>
      </DialogContent>
    </Dialog>
  );
};

// PromptInput Context and Components
interface PromptInputContextType {
  isLoading: boolean;
  value: string;
  setValue: (value: string) => void;
  maxHeight: number | string;
  onSubmit?: () => void;
  disabled?: boolean;
}
const PromptInputContext = React.createContext<PromptInputContextType>({
  isLoading: false,
  value: '',
  setValue: () => {},
  maxHeight: 240,
  onSubmit: undefined,
  disabled: false,
});
function usePromptInput() {
  const context = React.useContext(PromptInputContext);
  if (!context)
    throw new Error('usePromptInput must be used within a PromptInput');
  return context;
}

interface PromptInputProps {
  isLoading?: boolean;
  value?: string;
  onValueChange?: (value: string) => void;
  maxHeight?: number | string;
  onSubmit?: () => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}
const PromptInput = React.forwardRef<HTMLDivElement, PromptInputProps>(
  (
    {
      className,
      isLoading = false,
      maxHeight = 240,
      value,
      onValueChange,
      onSubmit,
      children,
      disabled = false,
      onDragOver,
      onDragLeave,
      onDrop,
    },
    ref,
  ) => {
    const [internalValue, setInternalValue] = React.useState(value || '');
    const handleChange = (newValue: string) => {
      setInternalValue(newValue);
      onValueChange?.(newValue);
    };
    return (
      <TooltipProvider>
        <PromptInputContext.Provider
          value={{
            isLoading,
            value: value ?? internalValue,
            setValue: onValueChange ?? handleChange,
            maxHeight,
            onSubmit,
            disabled,
          }}
        >
          <div
            ref={ref}
            className={cn(
              'rounded-3xl border border-[#444444] bg-[#1F2023] p-2 shadow-[0_8px_30px_rgba(0,0,0,0.24)] transition-all duration-300',
              // Working, not broken. Red read as an error on a box that was simply busy.
              isLoading && 'border-[#8B5CF6]/50 shadow-[0_8px_30px_rgba(139,92,246,0.12)]',
              className,
            )}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            {children}
          </div>
        </PromptInputContext.Provider>
      </TooltipProvider>
    );
  },
);
PromptInput.displayName = 'PromptInput';

interface PromptInputTextareaProps {
  disableAutosize?: boolean;
  placeholder?: string;
  /** Fires when the text starts/stops occupying more than one line. */
  onMultilineChange?: (multiline: boolean) => void;
}
const PromptInputTextarea: React.FC<
  PromptInputTextareaProps & React.ComponentProps<typeof Textarea>
> = ({
  className,
  onKeyDown,
  disableAutosize = false,
  placeholder,
  onMultilineChange,
  ...props
}) => {
  const { value, setValue, maxHeight, onSubmit, disabled } = usePromptInput();
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    const el = textareaRef.current;
    if (disableAutosize || !el) return;

    el.style.height = 'auto';
    const contentHeight = el.scrollHeight;
    el.style.height =
      typeof maxHeight === 'number'
        ? `${Math.min(contentHeight, maxHeight)}px`
        : `min(${contentHeight}px, ${maxHeight})`;

    // One line of text plus the vertical padding: anything taller has wrapped, which is
    // what moves the action buttons onto their own row.
    const style = window.getComputedStyle(el);
    const lineHeight = Number.parseFloat(style.lineHeight) || 24;
    const padding =
      Number.parseFloat(style.paddingTop) +
      Number.parseFloat(style.paddingBottom);
    onMultilineChange?.(contentHeight > lineHeight + padding + 2);
  }, [value, maxHeight, disableAutosize, onMultilineChange]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit?.();
    }
    onKeyDown?.(e);
  };

  return (
    <Textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      className={cn('text-base', className)}
      disabled={disabled}
      placeholder={placeholder}
      {...props}
    />
  );
};

const PromptInputActions: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  children,
  className,
  ...props
}) => (
  <div className={cn('flex items-center gap-2', className)} {...props}>
    {children}
  </div>
);

interface PromptInputActionProps extends React.ComponentProps<typeof Tooltip> {
  tooltip: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
}
const PromptInputAction: React.FC<PromptInputActionProps> = ({
  tooltip,
  children,
  className,
  side = 'top',
  ...props
}) => (
  <Tooltip {...props}>
    {/* `asChild` merges the trigger's props onto the child, so anything passed here lands
        on the button itself. Notably not `disabled`: the one button this wraps becomes
        Stop while a generation runs, and disabling it then is exactly when the user
        needs it. Buttons own their own disabled state. */}
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent side={side} className={className}>
      {tooltip}
    </TooltipContent>
  </Tooltip>
);

// Think toggle — switches on the advanced models, which pick framing and detail themselves.
// Locked until a coupon is applied: advanced mode spends frontier-model credits per prompt,
// so the server refuses it without a valid code and the button reflects that.
interface ThinkToggleProps {
  active: boolean;
  unlocked: boolean;
  onClick: () => void;
}
const ThinkToggle: React.FC<ThinkToggleProps> = ({
  active,
  unlocked,
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={unlocked ? active : undefined}
    className={cn(
      'flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-sm font-medium transition-all',
      active
        ? 'bg-[#8B5CF6]/20 text-[#A78BFA]'
        : 'bg-[#2E3033] text-[#9CA3AF] hover:bg-[#3A3A40] hover:text-[#D1D5DB]',
    )}
  >
    {unlocked ? (
      <Brain
        className={cn('h-4 w-4 shrink-0', active && 'text-[#A78BFA]')}
      />
    ) : (
      <Lock className="h-4 w-4 shrink-0" />
    )}
    <span className="whitespace-nowrap">Think</span>
  </button>
);

// Coupon entry, shown when a locked Think is pressed. Deliberately inline rather than a
// modal: it is one field, and the prompt the user was writing stays visible behind it.
interface CouponFormProps {
  onUnlocked: (code: string) => void;
  onDismiss: () => void;
}
const CouponForm: React.FC<CouponFormProps> = ({ onUnlocked, onDismiss }) => {
  const [code, setCode] = React.useState('');
  const [checking, setChecking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => inputRef.current?.focus(), []);

  const submit = async () => {
    const trimmed = code.trim();
    if (!trimmed || checking) return;
    setChecking(true);
    setError(null);
    const result = await checkCoupon(trimmed);
    setChecking(false);
    if (result.ok) onUnlocked(trimmed);
    else setError(result.message);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="mt-2 rounded-2xl border border-[#8B5CF6]/25 bg-[#8B5CF6]/[0.07] p-3"
    >
      <div className="flex items-center gap-2">
        <Lock className="h-4 w-4 shrink-0 text-[#A78BFA]" />
        <p className="flex-1 text-xs text-white/60">
          Think mode uses the advanced models. Enter your code to unlock it.
        </p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="text-white/40 transition-colors hover:text-white/80"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
            if (e.key === 'Escape') onDismiss();
          }}
          placeholder="Coupon code"
          autoComplete="off"
          spellCheck={false}
          aria-label="Coupon code"
          className="h-9 min-w-0 flex-1 rounded-full border border-[#444444] bg-[#15161A] px-3.5 text-sm text-gray-100 placeholder:text-gray-500 focus-visible:border-[#8B5CF6]/60 focus-visible:outline-none"
        />
        <Button
          variant="default"
          size="sm"
          className="h-9 shrink-0 rounded-full px-4"
          disabled={checking || code.trim() === ''}
          onClick={() => void submit()}
        >
          {checking ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            'Unlock'
          )}
        </Button>
      </div>

      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </motion.div>
  );
};

// Main PromptInputBox Component
interface PromptInputBoxProps {
  onSend?: (message: string, files: File[], options: GenerateOptions) => void;
  onStop?: () => void;
  isLoading?: boolean;
  /**
   * What the generation is doing right now, shown inside the box. The box stays typeable
   * while it runs, so this is a status line rather than a replacement for the input.
   */
  statusLabel?: string | null;
  placeholder?: string;
  className?: string;
}
export const PromptInputBox = React.forwardRef<
  HTMLDivElement,
  PromptInputBoxProps
>((props, ref) => {
  const {
    onSend = () => {},
    onStop = () => {},
    isLoading = false,
    statusLabel = null,
    placeholder = 'Describe the image you want to create…',
    className,
  } = props;
  const [input, setInput] = React.useState('');
  const [files, setFiles] = React.useState<File[]>([]);
  const [filePreviews, setFilePreviews] = React.useState<{
    [key: string]: string;
  }>({});
  const [selectedImage, setSelectedImage] = React.useState<string | null>(null);
  const [thinking, setThinking] = React.useState(false);
  // A previously applied code, so the toggle stays unlocked across reloads. The server
  // re-checks it on every generation, so a stale code costs a 403, not free access.
  const [coupon, setCoupon] = React.useState<string | null>(() => savedCoupon());
  const [showCouponForm, setShowCouponForm] = React.useState(false);
  const [isMultiline, setIsMultiline] = React.useState(false);
  const promptBoxRef = React.useRef<HTMLDivElement>(null);

  const isImageFile = (file: File) => file.type.startsWith('image/');

  const processFile = (file: File) => {
    if (!isImageFile(file)) return;
    if (file.size > 10 * 1024 * 1024) return;
    setFiles([file]);
    const reader = new FileReader();
    reader.onload = (e) =>
      setFilePreviews({ [file.name]: e.target?.result as string });
    reader.readAsDataURL(file);
  };

  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter((file) => isImageFile(file));
    if (imageFiles.length > 0) processFile(imageFiles[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRemoveFile = (index: number) => {
    const fileToRemove = files[index];
    if (fileToRemove && filePreviews[fileToRemove.name]) setFilePreviews({});
    setFiles([]);
  };

  const openImageModal = (imageUrl: string) => setSelectedImage(imageUrl);

  const handlePaste = React.useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          processFile(file);
          break;
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

  // Think selects the advanced models. Framing and detail are not exposed in the UI at all —
  // each mode's server-side defaults apply, so the payload carries the mode and nothing else.
  const unlocked = coupon !== null;
  const mode = thinking && unlocked ? 'advanced' : 'normal';

  // Locked: open the coupon field instead of toggling. Unlocked: plain toggle.
  const handleThinkClick = () => {
    if (!unlocked) {
      setShowCouponForm((prev) => !prev);
      return;
    }
    setThinking((prev) => !prev);
  };

  const handleUnlocked = (code: string) => {
    saveCoupon(code);
    setCoupon(code);
    setShowCouponForm(false);
    // Applying a code is how the user asked for Think, so turn it on rather than making
    // them press the button a second time.
    setThinking(true);
  };

  const handleSubmit = () => {
    if (input.trim() || files.length > 0) {
      onSend(input, files, {
        mode,
        ...(mode === 'advanced' && coupon ? { coupon } : {}),
      });
      setInput('');
      setFiles([]);
      setFilePreviews({});
    }
  };

  const hasContent = input.trim() !== '' || files.length > 0;

  return (
    <>
      <PromptInput
        value={input}
        onValueChange={setInput}
        isLoading={isLoading}
        onSubmit={handleSubmit}
        className={cn(
          'w-full bg-[#1F2023]/95 backdrop-blur-xl border-[#444444] shadow-[0_8px_30px_rgba(0,0,0,0.24)] transition-all duration-300 ease-in-out',
          className,
        )}
        ref={ref || promptBoxRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 p-0 pb-1 transition-all duration-300">
            {files.map((file, index) => (
              <div key={index} className="relative group">
                {file.type.startsWith('image/') && filePreviews[file.name] && (
                  <div
                    className="w-16 h-16 rounded-xl overflow-hidden cursor-pointer transition-all duration-300"
                    onClick={() => openImageModal(filePreviews[file.name])}
                  >
                    <img
                      src={filePreviews[file.name]}
                      alt={file.name}
                      className="h-full w-full object-cover"
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveFile(index);
                      }}
                      className="absolute top-1 right-1 rounded-full bg-black/70 p-0.5 opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3 text-white" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* On a phone the controls always take their own row: sharing one with the text left
            the textarea too narrow for the placeholder, which wrapped onto a second line.
            From sm up they sit inline until the text itself wraps. */}
        <div
          className={cn(
            'flex gap-2',
            isMultiline
              ? 'flex-col'
              : 'flex-col sm:flex-row sm:items-center',
          )}
        >
          <PromptInputTextarea
            placeholder={placeholder}
            className={cn('text-base', !isMultiline && 'min-w-0 sm:flex-1')}
            onMultilineChange={setIsMultiline}
          />

          <PromptInputActions
            className={cn(
              'flex items-center gap-2 p-0',
              isMultiline
                ? 'justify-end pt-1'
                : 'justify-end pt-1 sm:pt-0 sm:shrink-0',
            )}
          >
            <ThinkToggle
              active={thinking && unlocked}
              unlocked={unlocked}
              onClick={handleThinkClick}
            />

            <PromptInputAction
              tooltip={
                isLoading
                  ? 'Stop generating'
                  : mode === 'advanced'
                    ? 'Generate image · advanced models'
                    : 'Generate image'
              }
            >
              <Button
                variant="default"
                size="icon"
                className={cn(
                  'h-9 w-9 shrink-0 rounded-full transition-all duration-200',
                  isLoading || hasContent
                    ? 'bg-white hover:bg-white/80 text-[#1F2023]'
                    : 'bg-[#2E3033] hover:bg-[#3A3A40] text-[#9CA3AF] hover:text-[#D1D5DB]',
                )}
                onClick={() => {
                  if (isLoading) onStop();
                  else handleSubmit();
                }}
              >
                {isLoading ? (
                  <Square className="h-4 w-4 fill-[#1F2023] animate-pulse" />
                ) : (
                  <Send
                    className={cn(
                      'h-4 w-4',
                      hasContent ? 'text-[#1F2023]' : 'text-inherit',
                    )}
                  />
                )}
              </Button>
            </PromptInputAction>
          </PromptInputActions>
        </div>

        <AnimatePresence>
          {isLoading && statusLabel && (
            <motion.div
              key={statusLabel}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-2.5 px-3 pt-2 text-[13px] text-white/60">
                <span className="flex items-end gap-1">
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      className="h-1.5 w-1.5 rounded-full bg-white/70"
                      animate={{ y: [0, -5, 0], opacity: [0.4, 1, 0.4] }}
                      transition={{
                        duration: 0.9,
                        repeat: Infinity,
                        delay: i * 0.15,
                        ease: 'easeInOut',
                      }}
                    />
                  ))}
                </span>
                {statusLabel}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showCouponForm && !unlocked && (
            <CouponForm
              onUnlocked={handleUnlocked}
              onDismiss={() => setShowCouponForm(false)}
            />
          )}
        </AnimatePresence>
      </PromptInput>

      <ImageViewDialog
        imageUrl={selectedImage}
        onClose={() => setSelectedImage(null)}
      />
    </>
  );
});
PromptInputBox.displayName = 'PromptInputBox';
