import { VideoService } from '../../src/main/services/videoService'
import { DeviceService } from '../../src/main/services/deviceService'
import { WebviewService } from '../../src/main/services/webviewService'
import { FileSystemAdapter } from '../../src/main/adapters/filesystem/fileSystemAdapter'
import { fakeHdc } from './hdcFixture'

export function toolServices() {
  const hdc = fakeHdc()
  const devices = new DeviceService(hdc)
  const browser = {
    open: async (): Promise<never> => {
      throw new Error('unexpected browser operation')
    }
  }
  return {
    video: new VideoService(new FileSystemAdapter()),
    devices,
    webview: new WebviewService(devices, hdc, browser, browser)
  }
}
