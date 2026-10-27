package com.boxai.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class ValidationTest {
    @Test fun modelNameAccepted() {
        assertTrue(ModelManager.validName("gemma-2-2b-it-Q4_K_M.gguf"))
        assertTrue(ModelManager.validName("Qwen2.5 (1.5B) [Q8_0].gguf"))
    }

    @Test fun modelNameRejected() {
        assertFalse(ModelManager.validName("../evil.gguf"))
        assertFalse(ModelManager.validName("a/b.gguf"))
        assertFalse(ModelManager.validName("model.bin"))
        assertFalse(ModelManager.validName(".hidden.gguf"))
        assertFalse(ModelManager.validName("a..b.gguf"))
        assertFalse(ModelManager.validName(""))
    }

    @Test fun secretKeysWhitelisted() {
        listOf("hf", "gh", "cf", "meta").forEach { assertTrue(SecureStorage.validKey(it)) }
        assertFalse(SecureStorage.validKey("anything"))
        assertFalse(SecureStorage.validKey(""))
    }

    @Test fun textFileDetection() {
        assertTrue(WorkspaceManager.isText("catatan.md", 100))
        assertTrue(WorkspaceManager.isText("cfg.JSON", 100))
        assertFalse(WorkspaceManager.isText("model.gguf", 100))
        assertFalse(WorkspaceManager.isText("besar.txt", WorkspaceManager.MAX_TEXT + 1L))
    }

    @Test fun downloadRejectsNonHttps() {
        val d = BoxDownloads()
        val id = d.start("http://example.com/m.gguf", File("/tmp/m.gguf"), "")
        assertEquals(-1, id)
        assertTrue(d.lastError.contains("HTTPS"))
        d.shutdown()
    }

    @Test fun downloadRejectsGarbageUrl() {
        val d = BoxDownloads()
        assertEquals(-1, d.start("bukan url", File("/tmp/m.gguf"), ""))
        d.shutdown()
    }

    @Test fun unknownDownloadStatusIsZero() {
        val d = BoxDownloads()
        assertTrue(d.status(9999).contains("\"s\":0"))
        d.shutdown()
    }
}
