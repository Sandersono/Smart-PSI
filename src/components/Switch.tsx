import React from 'react';
import { motion } from 'framer-motion';

interface SwitchProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
}

export function Switch({ checked, onChange, disabled = false }: SwitchProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => !disabled && onChange(!checked)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 ${checked ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-gray-700'
                } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
            <span className="sr-only">Alternar opção</span>
            <motion.span
                layout
                transition={{ type: 'spring', stiffness: 700, damping: 30 }}
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'
                    }`}
            />
        </button>
    );
}
