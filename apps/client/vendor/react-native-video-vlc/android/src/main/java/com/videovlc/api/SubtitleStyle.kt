package com.videovlc.api

import com.facebook.react.bridge.ReadableMap
import com.videovlc.toolbox.ReactBridgeUtils.safeGetBool
import com.videovlc.toolbox.ReactBridgeUtils.safeGetInt

class SubtitleStyle(val options: ArrayList<String>) {

    companion object {
        private const val PROP_SUB_FONTSIZE = "fontSize"
        private val VALID_SUB_VALUES = arrayOf(0, 20, 18, 16, 12, 6)
        private const val OPTION_FONTSIZE = ":freetype-rel-fontsize="

        private const val PROP_SUB_COLOR = "color"
        private const val OPTION_COLOR = ":freetype-color="

        private const val PROP_SUB_BOLD = "bold"
        private const val OPTION_BOLD = ":freetype-bold"
        private const val OPTION_NOT_BOLD = ":no-freetype-bold"

        private const val PROP_SUB_BACK_OPACITY = "backgroundOpacity"
        private const val OPTION_BACK_OPACITY = ":freetype-background-opacity="

        private const val PROP_SUB_BACK_COLOR = "backgroundColor"
        private const val OPTION_BACK_COLOR = ":freetype-background-color="

        @JvmStatic
        fun parse(style: ReadableMap?): SubtitleStyle {
            val options = ArrayList<String>()
            var fontSize = safeGetInt(style, PROP_SUB_FONTSIZE, 0)
            if (fontSize !in VALID_SUB_VALUES) {
                fontSize = 0
            }
            options.add(OPTION_FONTSIZE + fontSize)

            val fontColor = safeGetInt(style, PROP_SUB_COLOR, 0x00ffffff)
            options.add(OPTION_COLOR + fontColor)

            val fontBold = safeGetBool(style, PROP_SUB_BOLD, false)
            options.add(if (fontBold) OPTION_BOLD else OPTION_NOT_BOLD)

            var backOpacity = safeGetInt(style, PROP_SUB_BACK_OPACITY, 0)
            if (backOpacity !in 0..255) {
                backOpacity = 0
            }
            options.add(OPTION_BACK_OPACITY + backOpacity)

            val backColor = safeGetInt(style, PROP_SUB_BACK_COLOR, 0)
            options.add(OPTION_BACK_COLOR + backColor)

            return SubtitleStyle(options)
        }
    }
}