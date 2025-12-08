import * as vscode from 'vscode';
import { TranslationKey, TranslationMap } from './types';
import { en } from './en';
import { zh_cn } from './zh-cn';

export type Language = 'auto' | 'en' | 'zh-cn';

export class LocalizationService {
    private static instance: LocalizationService;
    private currentLocale: TranslationMap = en;
    private language: Language = 'auto';

    private constructor() {
        this.updateLocale();
    }

    public static getInstance(): LocalizationService {
        if (!LocalizationService.instance) {
            LocalizationService.instance = new LocalizationService();
        }
        return LocalizationService.instance;
    }

    public setLanguage(lang: Language) {
        this.language = lang;
        this.updateLocale();
    }

    public getLanguage(): Language {
        return this.language;
    }

    private updateLocale() {
        if (this.language === 'auto') {
            const vscodeLang = vscode.env.language;
            // vscode.env.language returns 'en', 'zh-cn', 'zh-tw', etc.
            if (vscodeLang.toLowerCase().startsWith('zh')) {
                this.currentLocale = zh_cn;
            } else {
                this.currentLocale = en;
            }
        } else if (this.language === 'zh-cn') {
            this.currentLocale = zh_cn;
        } else {
            this.currentLocale = en;
        }
    }

    public t(key: TranslationKey, params?: { [key: string]: string | number }): string {
        let text = this.currentLocale[key] || en[key] || key;

        if (params) {
            Object.keys(params).forEach(param => {
                text = text.replace(`{${param}}`, String(params[param]));
            });
        }

        return text;
    }
}
