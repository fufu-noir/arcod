'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';

import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { ChevronDownIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

export const getHex = (themeValue: string, resolvedTheme: string | undefined): string => {
    if (themeValue === 'auto') {
        return resolvedTheme === 'light' ? '#1e3a8a' : '#60a5fa';
    }

    return themes.flatMap((group) => group.themes).find((theme) => theme.value.toLowerCase() === themeValue.toLowerCase())?.hex || '#60a5fa';
};

export const themes = [
    {
        group: 'Base',
        themes: [
            {
                value: 'light',
                label: 'Light',
                hex: '#1e3a8a'
            },
            {
                value: 'dark',
                label: 'Dark',
                hex: '#60a5fa'
            },
            {
                value: 'system',
                label: 'System',
                hex: 'auto'
            }
        ]
    },
    {
        group: 'Colored',
        themes: [
            {
                value: 'purple',
                label: 'Purple',
                hex: '#a855f7'
            },
            {
                value: 'pink',
                label: 'Pink',
                hex: '#f472b6'
            },
            {
                value: 'blue',
                label: 'Blue',
                hex: '#38bdf8'
            },
            {
                value: 'green',
                label: 'Green',
                hex: '#4ade80'
            },
            {
                value: 'red',
                label: 'Red',
                hex: '#f87171'
            },
            {
                value: 'orange',
                label: 'Orange',
                hex: '#fb923c'
            },
            {
                value: 'yellow',
                label: 'Yellow',
                hex: '#facc15'
            }
        ]
    }
];

export function ModeToggle() {
    const { setTheme, theme } = useTheme();
    const [position, setPosition] = useState<string>(theme!);

    useEffect(() => {
        document.documentElement.classList.remove(...Array.from(document.documentElement.classList));
        document.documentElement.classList.add(theme!);
    }, [theme]);

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant='outline' className='flex gap-2 items-center'>
                    <p className='capitalize'>{position}</p>
                    <ChevronDownIcon />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='start'>
                <DropdownMenuRadioGroup
                    value={position}
                    onValueChange={(position: string) => {
                        setPosition(position);
                        setTheme(position);
                    }}
                >
                    {themes.map((theme) => (
                        <DropdownMenuRadioGroup key={theme.group} value={position}>
                            <DropdownMenuLabel className='capitalize'>{theme.group}</DropdownMenuLabel>
                            {theme.themes.map((theme) => (
                                <DropdownMenuRadioItem
                                    key={theme.value}
                                    value={theme.value}
                                    className='capitalize'
                                    onClick={() => {
                                        setPosition(theme.value);
                                        setTheme(theme.value);
                                    }}
                                >
                                    {theme.label}
                                </DropdownMenuRadioItem>
                            ))}
                        </DropdownMenuRadioGroup>
                    ))}
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
