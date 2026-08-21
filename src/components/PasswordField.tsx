import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";

interface PasswordFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  visibilityName?: string;
  wrapperClassName?: string;
  toggleClassName?: string;
}

export function PasswordField({
  visibilityName = "password",
  wrapperClassName = "",
  toggleClassName = "",
  className = "",
  id,
  disabled,
  ...inputProps
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const actionLabel = `${visible ? "Hide" : "Show"} ${visibilityName}`;

  return (
    <div className={`relative ${wrapperClassName}`}>
      <input
        {...inputProps}
        id={id}
        type={visible ? "text" : "password"}
        disabled={disabled}
        className={`${className} pr-12`}
      />
      <button
        type="button"
        aria-label={actionLabel}
        aria-controls={id}
        aria-pressed={visible}
        title={actionLabel}
        disabled={disabled}
        onClick={() => setVisible((current) => !current)}
        className={`absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-lg text-industrial-muted transition-colors hover:text-industrial-text focus:outline-hidden focus-visible:ring-2 focus-visible:ring-[#3A8DFF] disabled:cursor-not-allowed disabled:opacity-50 ${toggleClassName}`}
      >
        {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      </button>
    </div>
  );
}
