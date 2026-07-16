package com.videovlc.api

import com.facebook.react.bridge.ReadableMap
import com.videovlc.toolbox.ReactBridgeUtils

/**
 * Class representing a sideLoaded text track from application Do you use player import in this
 * class
 */
class SideLoadedTrack {
    var language: String? = null
    var title: String? = null
    var uri: String = ""

    override fun equals(other: Any?): Boolean {
        if (other == null || other !is SideLoadedTrack) return false
        return language == other.language && title == other.title && uri == other.uri
    }

    companion object {
        val SIDELOAD_TEXT_TRACK_LANGUAGE = "language"
        val SIDELOAD_TEXT_TRACK_TITLE = "title"
        val SIDELOAD_TEXT_TRACK_URI = "uri"

        fun parse(src: ReadableMap?): SideLoadedTrack? {
            val sideLoadedTextTrack = SideLoadedTrack()
            if (src == null) {
                return null
            }
            val parsedUri = ReactBridgeUtils.safeGetString(src, SIDELOAD_TEXT_TRACK_URI, null)
            if (parsedUri == null) {
                return null
            }
            sideLoadedTextTrack.language =
                    ReactBridgeUtils.safeGetString(src, SIDELOAD_TEXT_TRACK_LANGUAGE, null)
            sideLoadedTextTrack.title =
                    ReactBridgeUtils.safeGetString(src, SIDELOAD_TEXT_TRACK_TITLE, null)
            sideLoadedTextTrack.uri = parsedUri

            return sideLoadedTextTrack
        }
    }
}