'use client';
import { createContext, useContext } from 'react';

// Set when an Admin is previewing the Staff portal as a specific staff member (read-only)
const Ctx = createContext(null);
export const PreviewProvider = ({ value, children }) => <Ctx.Provider value={value}>{children}</Ctx.Provider>;
export const usePreview = () => useContext(Ctx);
