import { useMemo, useState } from 'react'
import Alert from 'react-bootstrap/Alert'
import Button from 'react-bootstrap/Button'
import Card from 'react-bootstrap/Card'
import Col from 'react-bootstrap/Col'
import Container from 'react-bootstrap/Container'
import Form from 'react-bootstrap/Form'
import Row from 'react-bootstrap/Row'
import Spinner from 'react-bootstrap/Spinner'
import Table from 'react-bootstrap/Table'
import type { DateRange, Video } from '../../../shared/ipc'
import ConsolePanel from '../components/ConsolePanel'
import { useLogger } from '../hooks/useLogger'
import { formatDate, formatSize, todayStr } from '../lib/format'

const SOURCE_DEFAULT = 'D:\\steam\\steamapps\\workshop\\content\\431960'
const TARGET_DEFAULT = 'E:\\wallpaperVideo'

export default function WallpaperVideoTool() {
  const [source, setSource] = useState(SOURCE_DEFAULT)
  const [target, setTarget] = useState(TARGET_DEFAULT)
  const [dateStart, setDateStart] = useState('')
  const [dateEnd, setDateEnd] = useState(todayStr)
  const [videos, setVideos] = useState<Video[]>([])
  const [scanning, setScanning] = useState(false)
  const [moving, setMoving] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const { log, error, clear, logs } = useLogger()

  const totalSize = useMemo(() => videos.reduce((s, v) => s + v.size, 0), [videos])

  const handlePickSource = async (): Promise<void> => {
    try {
      const picked = await window.api.selectFolder()
      if (picked) setSource(picked)
    } catch (e) {
      error(`选择源目录失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const handlePickTarget = async (): Promise<void> => {
    try {
      const picked = await window.api.selectFolder()
      if (picked) setTarget(picked)
    } catch (e) {
      error(`选择目标目录失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const handleScan = async (): Promise<void> => {
    setScanError(null)
    if (!source.trim()) {
      error('请输入源文件夹路径')
      return
    }
    setScanning(true)
    setVideos([])
    clear()

    let dateRange: DateRange | null = null
    if (dateStart || dateEnd) {
      if (!dateStart || !dateEnd) {
        error('请填写完整的起止日期')
        setScanning(false)
        return
      }
      dateRange = { start: dateStart, end: dateEnd }
      log(`开始扫描: ${source}，时间段: ${dateStart} ~ ${dateEnd}`)
    } else {
      log(`开始扫描: ${source}，全部文件`)
    }

    try {
      const result = await window.api.file.scanVideos(source, dateRange)
      setVideos(result)
      log(`扫描完成，找到 ${result.length} 个视频文件`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      error(`扫描失败: ${msg}`)
      setScanError(msg)
    } finally {
      setScanning(false)
    }
  }

  const handleMove = async (): Promise<void> => {
    if (!target.trim()) {
      error('请输入目标文件夹路径')
      return
    }
    if (videos.length === 0) {
      error('没有可移动的视频文件，请先扫描')
      return
    }
    setMoving(true)
    log(`开始移动 ${videos.length} 个文件到: ${target}`)
    try {
      const result = await window.api.file.moveVideos(videos, target)
      if (result.success) {
        log(`移动完成，成功: ${result.moved.length} 个`)
        result.moved.forEach((name) => log(`  ✓ ${name}`))
        setVideos([])
      } else {
        error(`移动完成，部分失败 (${result.failed.length} 个)`)
        result.failed.forEach((f) => log(`  ✗ ${f.path}: ${f.error}`))
      }
    } catch (e) {
      error(`移动异常: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setMoving(false)
    }
  }

  return (
    <Container fluid className="py-3" style={{ paddingBottom: 240 }}>
      <Card>
        <Card.Header>
          <Card.Title as="h5" className="mb-0">
            <i className="bi bi-camera-reels me-2" />
            视频提取工具
          </Card.Title>
        </Card.Header>
        <Card.Body>
          {scanError && (
            <Alert variant="danger" dismissible onClose={() => setScanError(null)}>
              {scanError}
            </Alert>
          )}

          {/* 源文件夹 + 时间范围 */}
          <Form.Group className="mb-3" controlId="source-dir">
            <Form.Label>源文件夹（子文件夹）</Form.Label>
            <Row className="g-2 align-items-center">
              <Col>
                <Form.Control
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="例如 D:\\steam\\steamapps\\workshop\\content\\431960"
                />
              </Col>
              <Col xs="auto">
                <Button variant="outline-secondary" onClick={handlePickSource} title="选择源目录">
                  <i className="bi bi-folder2-open" />
                </Button>
              </Col>
              <Col xs="auto" className="text-secondary">
                从
              </Col>
              <Col xs="auto">
                <Form.Control
                  type="date"
                  value={dateStart}
                  onChange={(e) => setDateStart(e.target.value)}
                  style={{ width: 160 }}
                />
              </Col>
              <Col xs="auto" className="text-secondary">
                到
              </Col>
              <Col xs="auto">
                <Form.Control
                  type="date"
                  value={dateEnd}
                  onChange={(e) => setDateEnd(e.target.value)}
                  style={{ width: 160 }}
                />
              </Col>
              <Col xs="auto">
                <Button variant="primary" onClick={handleScan} disabled={scanning}>
                  {scanning ? (
                    <>
                      <Spinner as="span" animation="border" size="sm" className="me-2" />
                      扫描中...
                    </>
                  ) : (
                    <>
                      <i className="bi bi-folder-symlink me-1" />
                      扫描
                    </>
                  )}
                </Button>
              </Col>
            </Row>
            <Form.Text className="text-secondary">日期留空则提取全部视频</Form.Text>
          </Form.Group>

          {/* 目标文件夹 */}
          <Form.Group className="mb-3" controlId="target-dir">
            <Form.Label>目标文件夹</Form.Label>
            <Row className="g-2 align-items-center">
              <Col>
                <Form.Control
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder="例如 E:\\wallpaperVideo"
                />
              </Col>
              <Col xs="auto">
                <Button variant="outline-secondary" onClick={handlePickTarget} title="选择目标目录">
                  <i className="bi bi-folder2-open" />
                </Button>
              </Col>
              <Col xs="auto">
                <Button
                  variant="success"
                  onClick={handleMove}
                  disabled={moving || videos.length === 0}
                >
                  {moving ? (
                    <>
                      <Spinner as="span" animation="border" size="sm" className="me-2" />
                      移动中...
                    </>
                  ) : (
                    <>
                      <i className="bi bi-play-fill me-1" />
                      移动{videos.length > 0 ? ` (${videos.length})` : ''}
                    </>
                  )}
                </Button>
              </Col>
            </Row>
          </Form.Group>

          {/* 视频列表 */}
          {videos.length > 0 && (
            <div>
              <div className="d-flex align-items-center justify-content-between mb-2">
                <h6 className="mb-0">扫描结果（{videos.length} 个视频）</h6>
                <small className="text-secondary">
                  总计 {formatSize(totalSize)}
                </small>
              </div>
              <div className="border rounded overflow-auto" style={{ maxHeight: 320 }}>
                <Table size="sm" variant="dark" striped hover className="mb-0">
                  <thead className="sticky-top">
                    <tr className="text-secondary">
                      <th style={{ width: '40%' }}>文件名</th>
                      <th style={{ width: '20%' }}>来源子目录</th>
                      <th style={{ width: '25%' }}>下载时间</th>
                      <th className="text-end" style={{ width: '15%' }}>大小</th>
                    </tr>
                  </thead>
                  <tbody>
                    {videos.map((v) => (
                      <tr key={v.path}>
                        <td className="font-monospace text-break">{v.name}</td>
                        <td className="text-secondary">{v.fromSubfolder}</td>
                        <td className="text-secondary font-monospace">{formatDate(v.folderMtime)}</td>
                        <td className="text-end font-monospace">{formatSize(v.size)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </div>
          )}
        </Card.Body>
      </Card>

      <ConsolePanel logs={logs} onClear={clear} />
    </Container>
  )
}
