/* ============================================================
 * 可复用逻辑：把“表格的一切行为”都写在这里
 * ==========================================================*/
import {
  ref, reactive, computed, watch,
  onMounted, onUnmounted, nextTick
} from 'vue'
import axios, { AxiosResponse } from 'axios'
import Sortable from 'sortablejs'

/* =============================== 类型声明 ===============================*/
export interface DataGridApiSet {
  query  : string   // 列表查询
  save   : string   // 新增 / 更新
  remove : string   // 删除
  export : string   // CSV 导出
  color  : string   // 单格颜色标记
  alias  : string   // 自定义列别名保存
  aliasQ?: string   // 自定义列别名查询（可选）
  colorQ?: string   // 颜色标记批量查询（可选）
}

export interface DataGridConfig {
  apis         : DataGridApiSet
  /* 字段常量 */
  fieldList    : string[]
  readOnly     : string[]
  numberFields : string[]
  dateFields   : string[]
  /* 其它可调参数 */
  pageSize?    : number
  baseOffset?  : number
}

/* =============================== 颜色常量 ===============================*/
const COLOR_MAP = [
  { name: '淡黄色', value: '#ffffcc' },
  { name: '淡蓝色', value: '#ccffff' },
  { name: '淡红色', value: '#ffcccc' },
  { name: '淡绿色', value: '#ccffcc' },
  { name: '淡灰色', value: '#f2f2f2' },
  { name: '浅紫色', value: '#e6ccff' },
  { name: '浅橙色', value: '#ffe6cc' },
  { name: '浅藏青', value: '#ccd9ff' },
  { name: '浅玫红', value: '#ffccd9' },
  { name: '白色',   value: '#ffffff' }
]

/* =============================== Axios 全局封装 =========================*/
axios.interceptors.response.use(
  (resp: AxiosResponse<any>) => {
    if (resp.config.responseType === 'blob') return resp
    if (resp.status === 200) return resp.data
    return Promise.reject(new Error(resp.data?.body || '业务异常'))
  },
  err => Promise.reject(err)
)

/* =============================== 主函数 ================================*/
export function useDataGrid (cfg: DataGridConfig) {
  /* ----------- 参数解包 / 默认值 ----------- */
  const fieldList    = ref([...cfg.fieldList])
  const readOnlyFields  = cfg.readOnly
  const numberFields  = cfg.numberFields
  const dateFields    = cfg.dateFields
  const baseOffset    = cfg.baseOffset ?? 3     // 复选框 + 行号 + 拖拽
  const tailFixed     = 3                       // 操作 / 删除 / 复制
  const pageSize      = cfg.pageSize  ?? 500

  /* ----------- 响应式变量 ----------- */
  const records           = ref<any[]>([])
  const uniqueValues      = computed(() => {
    const obj: Record<string, any[]> = {}
    fieldList.value.forEach(f => (obj[f] = []))
    records.value.forEach(r => {
      fieldList.value.forEach(f => {
        const v = r[f]
        if (v !== null && v !== undefined && !obj[f].includes(v)) obj[f].push(v)
      })
    })
    return obj
  })
  const aliasMap          = ref<Record<string, string>>({})
  const exactFilters      = reactive<Record<string, any[]>>({})
  const fuzzyFilters      = reactive<Record<string, string>>({})
  const modifiedIds       = ref<number[]>([])
  const selectedRowIds    = ref<number[]>([])
  const loading           = ref(false)
  const showNotification  = ref(false)
  const notificationMessage = ref('')
  const notificationType    = ref<'success'|'error'>('success')
  const sortField         = ref('')
  const sortOrder         = ref<'asc'|'desc'>('asc')
  const letters           = ref(generateLetters(fieldList.value.length))
  const visibleColumns    = ref<string[]>(JSON.parse(localStorage.getItem('visibleColumns') || '[]') || [...fieldList.value])
  const visibleColumnsProxy = computed({
    get: () => visibleColumns.value,
    set: v  => (visibleColumns.value = v)
  })
  const page              = ref(1)
  const limit             = ref(pageSize)
  const total             = ref(0)

  /* 拖拽相关 */
  const tbodyRef          = ref<HTMLElement|null>(null)
  let   tbodySortable     : Sortable | null = null
  const tableContainerRef = ref<HTMLElement|null>(null)

  /* 列宽 */
  const columnWidths      = ref<number[]>(new Array(fieldList.value.length + baseOffset + tailFixed).fill(120))

  /* 统计 */
  const statsCount  = ref('')
  const statsSum    = ref('')
  const statsAvg    = ref('')

  /* 选区 / 填充 */
  const selectedCells = ref<string[]>([])
  const dragSelecting = ref(false)
  const dragCandidate = ref(false)
  const mouseDownX    = ref(0)
  const mouseDownY    = ref(0)
  const selectionStart = reactive({ rowIndex:-1, colIndex:-1 })
  const fillPreview    = reactive({ visible:false,x:0,y:0,width:0,height:0 })
  const fillPreviewStyles = computed(() => ({
    position:'absolute', top:fillPreview.y+'px', left:fillPreview.x+'px',
    width:fillPreview.width+'px', height:fillPreview.height+'px'
  }))
  let fillDragging=false, fillSourceRow=-1, fillSourceField='', fillSourceColIndex=-1

  /* 弹窗 */
  const showEditFieldsModal = ref(false)
  const aliasForm = reactive<Record<string,string>>({
    ext1:'', ext2:'', ext3:'', ext4:'', ext5:'', ext6:'', ext7:'', ext8:'', ext9:'', ext10:''
  })
  const showConfirmModal = ref(false)
  let   pendingUpdateId  : number|null = null
  const highlightedRows  = ref<number[]>([])

  /* 多选精确筛选面板 */
  const exactFilterDropdownOpen = ref(false)
  const currentExactField       = ref('')
  const exactFilterTempValues   = ref<any[]>([])
  const exactDropdownPosition   = reactive({ top:0,left:0,width:200 })

  /* 颜色填充 */
  const colorDropdownOpen = ref(false)
  const currentFillColor  = ref(COLOR_MAP[0].value)
  const currentFillName   = ref(COLOR_MAP[0].name)
  const paletteColors     = COLOR_MAP
  const cellColors        = reactive<Record<string, Record<string,string>>>({})
  const colorFillWrapperRef = ref<HTMLElement|null>(null)

  /* ================ 工具函数 ================*/
  function notify (msg:string,type:'success'|'error'='success') {
    notificationMessage.value = msg
    notificationType.value    = type
    showNotification.value    = true
    setTimeout(() => (showNotification.value = false), 3000)
  }
  const startLoading = () => (loading.value = true)
  const stopLoading  = () => (loading.value = false)

  function generateLetters (n:number) {
    const arr:string[]=[]
    const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    for(let i=0;i<n;i++){
      let s='',k=i
      do { s=chars[k%26]+s; k=Math.floor(k/26)-1 } while(k>=0)
      arr.push(s)
    }
    return arr
  }
  const colorNameToHex = (name:string) => COLOR_MAP.find(c => c.name===name)?.value || ''

  /* ================ API 封装 ================*/
  function apiQueryList () {
    startLoading()
    const payload:Record<string,any> = { page: page.value, limit: limit.value }
    fieldList.value.forEach(f => {
      if (exactFilters[f]?.length) payload[f] = exactFilters[f].join(',')
      if (fuzzyFilters[f])         payload[f] = fuzzyFilters[f]
    })
    return axios.post(cfg.apis.query, payload)
      .then(async (res:any) => {
        records.value = res.records
        total.value   = res.total
        await fetchCellColorMarks()
      })
      .catch(e => notify(e.message,'error'))
      .finally(stopLoading)
  }
  const apiSaveOrUpdate = (row:any)    => axios.post(cfg.apis.save  , row)
  const apiDelete       = (ids:number[])=> axios.post(cfg.apis.remove, ids)
  function apiExportCsv (){
    startLoading()
    const payload:Record<string,string> = {}
    fieldList.value.forEach(f=>{
      if(exactFilters[f]?.length) payload[f]=exactFilters[f].join(',')
      if(fuzzyFilters[f])         payload[`${f}__like`]=fuzzyFilters[f]
    })
    return axios({
      url: cfg.apis.export,
      method:'post',
      responseType:'blob',
      data: payload
    }).then(resp=>{
      const blob=new Blob([resp.data],{type:'text/csv;charset=utf-8'})
      const url=URL.createObjectURL(blob)
      const a=document.createElement('a')
      a.href=url
      a.download=`export_${Date.now()}.csv`
      a.click()
      URL.revokeObjectURL(url)
    }).catch(e=>notify(e.message,'error')).finally(stopLoading)
  }
  const apiColorMark = (bizId:number,field:string,colorName:string) =>
    axios.post(cfg.apis.color,{ businessId:String(bizId), columnKey:field, operationResult:JSON.stringify({[field]:colorName}) })

  const apiSaveDefinedHeaders = (aliasObj:Record<string,string>) =>
    axios.post(cfg.apis.alias,{ businessType:'1',operationType:'1',operationResult:JSON.stringify(aliasObj) })

  /* -------------------------- 关键修改开始 -------------------------- */
  async function fetchDefinedHeaders () {
    if (!cfg.apis.aliasQ) return
    try {
      const res: any = await axios.post(cfg.apis.aliasQ, {})
      // res 可能本身就是数组，也可能是类似 { body: [...] }
      const list = Array.isArray(res) ? res : (res?.body || [])
      if (!list.length) return
      const latest = list[0]
      let op = latest.operationResult
      op = typeof op === 'string' ? JSON.parse(op) : op
      if (op && typeof op === 'object') aliasMap.value = { ...op }
    } catch (e) { console.error('加载自定义列别名失败：', e) }
  }

  async function fetchCellColorMarks () {
    if (!cfg.apis.colorQ) return
    try {
      const res: any = await axios.post(cfg.apis.colorQ, {})
      // 同上：先判定 res 是否数组
      const list = Array.isArray(res) ? res : (res?.body || [])
      Object.keys(cellColors).forEach(k=>delete cellColors[k])
      list.forEach((row:any)=>{
        const bizId=String(row.businessId||'').trim()
        if (!bizId) return
        let op=row.operationResult
        try { op = typeof op==='string'?JSON.parse(op):op } catch { op=null }
        if (!op || typeof op!=='object') return
        Object.entries(op).forEach(([f,cName])=>{
          const hex=colorNameToHex(cName as string)
          if (!hex) return
          if (!cellColors[bizId]) cellColors[bizId]={}
          cellColors[bizId][f]=hex
        })
      })
    } catch(e){ console.error('颜色标记查询失败：', e) }
  }
  /* -------------------------- 关键修改结束 -------------------------- */

  /* ================ 初始化 ================*/
  onMounted(async () => {
    document.addEventListener('mousedown',handleClickOutside)
    await fetchDefinedHeaders()
    if(!visibleColumns.value.length) visibleColumns.value=[...fieldList.value]
    fieldList.value.forEach(f=>{exactFilters[f]=[];fuzzyFilters[f]=''})
    await apiQueryList()
    nextTick(initTableDrag)
  })
  onUnmounted(() => document.removeEventListener('mousedown',handleClickOutside))
  watch(records,()=>nextTick(initTableDrag),{deep:false})

  /* ================ 其余所有原始逻辑 ================*/
  /* 以下所有函数与原 App.vue 一致，只把固定常量或接口换成 cfg.xxx
     —— 为节省篇幅不再重复解释；但代码**完整保留** */

  function handleClickOutside (ev:MouseEvent) {
    if (!colorDropdownOpen.value) return
    if (colorFillWrapperRef.value && !colorFillWrapperRef.value.contains(ev.target as Node))
      colorDropdownOpen.value = false
  }

  /* ---------- 拖拽排序 ---------- */
  function initTableDrag () {
    if(!tbodyRef.value) return
    if(tbodySortable){ tbodySortable.destroy(); tbodySortable=null }
    tbodySortable = Sortable.create(tbodyRef.value,{
      handle:'.drag-handle', animation:150,
      onEnd: evt=>{
        const oldIdx=evt.oldIndex!, newIdx=evt.newIndex!
        if(oldIdx===newIdx) return
        const item=records.value.splice(oldIdx,1)[0]
        records.value.splice(newIdx,0,item)
        if(sortField.value){ sortField.value=''; sortOrder.value='asc' }
      }
    })
  }

  /* ---------- 列宽调整 ---------- */
  let resizing=false,startX=0,startW=0,resizingIdx=-1
  function initResize(e:MouseEvent,idx:number){
    e.preventDefault(); resizing=true; resizingIdx=idx
    startX=e.clientX; startW=columnWidths.value[idx]||120
    document.addEventListener('mousemove',onResizing)
    document.addEventListener('mouseup',stopResize)
  }
  function onResizing(e:MouseEvent){
    if(!resizing) return
    const dx=e.clientX-startX
    columnWidths.value[resizingIdx]=Math.max(40,startW+dx)
  }
  function stopResize(){
    resizing=false
    document.removeEventListener('mousemove',onResizing)
    document.removeEventListener('mouseup',stopResize)
  }
  function colStyle(idx:number){
    if(idx===0) return {width:'40px',minWidth:'40px',maxWidth:'40px'}
    if(idx===1||idx===2) return {width:'50px',minWidth:'50px',maxWidth:'50px'}
    if(idx>=fieldList.value.length+baseOffset) return {width:'80px',minWidth:'80px',maxWidth:'80px'}
    const w=columnWidths.value[idx]||120
    return {width:`${w}px`,minWidth:`${w}px`,maxWidth:`${w}px`}
  }

  /* ---------- 筛选 / 排序 ---------- */
  const applyFilters = () => apiQueryList()
  function resetFilters (){
    fieldList.value.forEach(f=>{exactFilters[f]=[];fuzzyFilters[f]=''})
    apiQueryList()
  }
  function handleSort(f:string){
    if(sortField.value===f) sortOrder.value=sortOrder.value==='asc'?'desc':'asc'
    else { sortField.value=f; sortOrder.value='asc' }
  }
  const sortedRecords = computed(()=>{
    let arr=[...records.value]
    if(!sortField.value) return arr
    arr.sort((a,b)=>{
      const av=a[sortField.value]??'', bv=b[sortField.value]??''
      const an=parseFloat(av), bn=parseFloat(bv)
      if(!isNaN(an)&&!isNaN(bn)) return sortOrder.value==='asc'?an-bn:bn-an
      return sortOrder.value==='asc'?String(av).localeCompare(bv):String(bv).localeCompare(av)
    })
    return arr
  })

  /* ---------- 修改 / 删除 / 复制 ---------- */
  const markModified = (id:number) => { if(!modifiedIds.value.includes(id)) modifiedIds.value.push(id) }
  const openConfirmModal = (id:number) => { pendingUpdateId=id; showConfirmModal.value=true }
  const closeConfirmModal = () => { showConfirmModal.value=false; pendingUpdateId=null }
  async function confirmUpdateAction (){ pendingUpdateId && await updateSingleRecord(pendingUpdateId); closeConfirmModal() }
  async function updateSingleRecord(id:number){
    try{
      startLoading()
      const rec=records.value.find(r=>r.id===id)
      if(!rec) return notify('记录不存在','error')
      await apiSaveOrUpdate({...rec})
      modifiedIds.value=modifiedIds.value.filter(x=>x!==id)
      notify('更新成功')
    }catch(e:any){ notify(e.message,'error') }finally{ stopLoading() }
  }
  async function batchModify(){
    const list=records.value.filter(r=>modifiedIds.value.includes(r.id))
    if(!list.length) return notify('没有任何修改','error')
    if(!confirm(`确定批量提交 ${list.length} 条修改？`)) return
    startLoading()
    try{
      await Promise.all(list.map(r=>apiSaveOrUpdate({...r})))
      modifiedIds.value=[]
      notify('批量修改成功')
    }catch(e:any){ notify(e.message,'error') }finally{ stopLoading() }
  }
  async function batchDelete(){
    if(!selectedRowIds.value.length) return notify('请先勾选要删除的行','error')
    if(!confirm(`确定删除选中的 ${selectedRowIds.value.length} 行？此操作无法撤销`)) return
    try{
      startLoading()
      await apiDelete([...selectedRowIds.value])
      records.value = records.value.filter(r=>!selectedRowIds.value.includes(r.id))
      selectedRowIds.value=[]
      notify('批量删除成功')
    }catch(e:any){notify(e.message,'error')}finally{stopLoading()}
  }
  async function deleteRecord(id:number){
    if(!confirm('确定删除？此操作无法撤销')) return
    try{
      startLoading()
      await apiDelete([id])
      records.value = records.value.filter(r=>r.id!==id)
      selectedRowIds.value = selectedRowIds.value.filter(x=>x!==id)
      notify('删除成功')
    }catch(e:any){notify(e.message,'error')}finally{stopLoading()}
  }
  async function copyRecord(id:number){
    const src=records.value.find(r=>r.id===id)
    if(!src) return
    const copy={...src, id:null}
    try{ startLoading(); await apiSaveOrUpdate(copy); await apiQueryList(); notify('复制成功') }
    catch(e:any){ notify(e.message,'error') } finally{ stopLoading() }
  }
  async function addEmptyRow(){
    try{ startLoading(); await apiSaveOrUpdate({}); await apiQueryList(); notify('新增成功') }
    catch(e:any){ notify(e.message,'error') } finally{ stopLoading() }
  }
  const downloadCsv = () => apiExportCsv()

  /* ---------- 复制 / 粘贴 ---------- */
  function onCellClick(e:MouseEvent,f:string,rowIdx:number){
    if(dragSelecting.value) return
    const cellId=rowIdx+'-'+f
    if(e.shiftKey && selectedCells.value.length){
      const [lr,lf] = selectedCells.value[selectedCells.value.length-1].split('-')
      const startR=Math.min(parseInt(lr),rowIdx), endR=Math.max(parseInt(lr),rowIdx)
      const startC=Math.min(fieldList.value.indexOf(lf),fieldList.value.indexOf(f))
      const endC=Math.max(fieldList.value.indexOf(lf),fieldList.value.indexOf(f))
      const newSel:string[]=[]
      for(let r=startR;r<=endR;r++)
        for(let c=startC;c<=endC;c++){
          const fld=fieldList.value[c]
          if(visibleColumns.value.includes(fld)) newSel.push(r+'-'+fld)
        }
      selectedCells.value=newSel
    }else if(e.ctrlKey||e.metaKey){
      if(selectedCells.value.includes(cellId))
        selectedCells.value=selectedCells.value.filter(x=>x!==cellId)
      else selectedCells.value=[...selectedCells.value,cellId]
    }else selectedCells.value=[cellId]
  }
  const onCellDblClick = (e:MouseEvent) => {
    const inp=(e.currentTarget as HTMLElement).querySelector('input:not([readonly])') as HTMLInputElement|null
    inp && inp.focus()
  }
  const isCellSelected = (r:number,f:string) => selectedCells.value.includes(r+'-'+f)
  document.addEventListener('keydown',e=>{
    if(!selectedCells.value.length) return
    if((e.ctrlKey||e.metaKey)&&['c','C'].includes(e.key)){ e.preventDefault(); copySelectedCells() }
    if((e.ctrlKey||e.metaKey)&&['v','V'].includes(e.key)){ e.preventDefault(); pasteClipboardData() }
  })
  function copySelectedCells(){
    const rowMap:Record<string,Record<string,any>>={}
    selectedCells.value.forEach(cell=>{
      const [r,f]=cell.split('-'); if(!rowMap[r]) rowMap[r]={}
      rowMap[r][f]=records.value[parseInt(r)][f]??''
    })
    const lines:string[]=[]
    Object.keys(rowMap).sort((a,b)=>+a-+b).forEach(r=>{
      const cols=rowMap[r]
      const ordered=Object.keys(cols).sort((a,b)=>fieldList.value.indexOf(a)-fieldList.value.indexOf(b))
      lines.push(ordered.map(c=>cols[c]).join('\t'))
    })
    navigator.clipboard.writeText(lines.join('\n')).then(()=>notify('已复制'))
  }
  async function pasteClipboardData(){
    try{
      const text=await navigator.clipboard.readText()
      if(!text.trim()) return
      const lines=text.split('\n').filter(l=>l.trim()!=='')
      const [sr,sf]=selectedCells.value[selectedCells.value.length-1].split('-')
      let rIdx=parseInt(sr)
      for(const line of lines){
        const vals=line.split('\t')
        let cIdx=fieldList.value.indexOf(sf)
        for(const val of vals){
          if(rIdx<records.value.length && cIdx<fieldList.value.length){
            const fld=fieldList.value[cIdx]
            if(!readOnlyFields.includes(fld)){ records.value[rIdx][fld]=val; markModified(records.value[rIdx].id) }
          }
          cIdx++
        }
        rIdx++
      }
      notify('粘贴完成')
    }catch(e){notify('粘贴失败','error')}
  }

  /* ---------- 颜色填充 ---------- */
  const toggleColorDropdown = () => (colorDropdownOpen.value = !colorDropdownOpen.value)
  async function applyFillColor (clr:{name:string,value:string}){
    colorDropdownOpen.value=false
    currentFillColor.value=clr.value; currentFillName.value=clr.name
    if(!selectedCells.value.length) return notify('请先选择要填充的单元格','error')
    selectedCells.value.forEach(cell=>{
      const [r,f]=cell.split('-')
      const row=records.value[+r]
      if(!row) return
      if(!cellColors[row.id]) cellColors[row.id]={}
      cellColors[row.id][f]=clr.value
    })
    try{
      startLoading()
      const tasks=selectedCells.value.map(cell=>{
        const [r,f]=cell.split('-')
        const row=records.value[+r]
        return apiColorMark(row.id,f,clr.name)
      })
      await Promise.all(tasks)
      notify('颜色保存成功')
    }catch(e:any){
      selectedCells.value.forEach(cell=>{
        const [r,f]=cell.split('-'); const row=records.value[+r]
        if(row && cellColors[row.id]) delete cellColors[row.id][f]
      })
      notify(e.message||'颜色保存失败','error')
    }finally{ stopLoading() }
  }
  const getCellFillColor = (rowId:number,field:string) => cellColors[rowId]?.[field] || ''

  /* ---------- 统计 ---------- */
  watch(selectedCells,updateStatistics)
  function updateStatistics(){
    if(!selectedCells.value.length){statsCount.value='';statsSum.value='';statsAvg.value='';return}
    statsCount.value=`计数: ${selectedCells.value.length}`
    let sum=0,numCnt=0,allNum=true
    selectedCells.value.forEach(cell=>{
      const [r,f]=cell.split('-'); const v=records.value[+r]?.[f]??''
      const n=parseFloat(v); if(isNaN(n)) allNum=false; else{sum+=n; numCnt++}
    })
    if(allNum&&numCnt){ statsSum.value=`求和: ${sum}`; statsAvg.value=`平均值: ${(sum/numCnt).toFixed(3)}` }
    else {statsSum.value=''; statsAvg.value=''}
  }

  /* ---------- UI 其它 ---------- */
  const getRowColor = (c:string) => {
    switch(c){case'淡黄色':return'#ffffcc';case'淡灰色':return'#f2f2f2';case'淡蓝色':return'#ccffff';case'淡红色':return'#ffcccc';case'淡绿色':return'#ccffcc';default:return'#fff'}
  }
  const getAlias = (f:string) => aliasMap.value[f] || f

  /* ---------- 列别名 & 列可见性 ---------- */
  function openEditFieldsModal(){
    for(let n=1;n<=10;n++) aliasForm['ext'+n]=aliasMap.value['ext'+n]||''
    showEditFieldsModal.value=true
  }
  function closeEditFieldsModal(){showEditFieldsModal.value=false}
  const isAllChecked = computed(()=>visibleColumns.value.length===fieldList.value.length)
  const toggleSelectAll = (e:Event) =>{
    const tgt=e.target as HTMLInputElement
    visibleColumns.value=tgt.checked?[...fieldList.value]:[]
  }
  async function saveFieldsAndAliases(){
    localStorage.setItem('visibleColumns',JSON.stringify(visibleColumns.value))
    const aliasObj:Record<string,string>={}
    for(let n=1;n<=10;n++){
      const v=(aliasForm['ext'+n]||'').trim()
      if(v) aliasObj['ext'+n]=v
    }
    try{
      if(Object.keys(aliasObj).length){
        startLoading(); await apiSaveDefinedHeaders(aliasObj); aliasMap.value={...aliasObj}; notify('已保存自定义列别名')
      }else notify('未填写任何别名，仅保存列可见性')
    }catch(e:any){ notify(e.message||'保存失败','error') }finally{ stopLoading() }
    closeEditFieldsModal()
  }

  /* ---------- 精确筛选 ---------- */
  function openExactFilter(field:string,ev:MouseEvent){
    currentExactField.value=field
    exactFilterTempValues.value=[...exactFilters[field]]
    exactFilterDropdownOpen.value=true
    const rect=(ev.target as HTMLElement).getBoundingClientRect()
    exactDropdownPosition.top=rect.bottom+window.scrollY
    exactDropdownPosition.left=rect.left+window.scrollX
    exactDropdownPosition.width=Math.max(200,rect.width)
  }
  function confirmExactFilter(){
    exactFilters[currentExactField.value]=[...exactFilterTempValues.value]
    exactFilterDropdownOpen.value=false
    applyFilters()
  }
  const cancelExactFilter = () => (exactFilterDropdownOpen.value=false)
  function removeExactFilterItem(f:string,v:any){
    exactFilters[f]=exactFilters[f].filter(x=>x!==v); applyFilters()
  }

  /* ---------- 列字母点击 ---------- */
  function onColumnLetterClick(e:MouseEvent,colIdx:number,field:string){
    if((e.target as HTMLElement).classList.contains('resizer')) return
    const sel:string[]=[]
    for(let r=0;r<records.value.length;r++)
      if(visibleColumns.value.includes(field)) sel.push(r+'-'+field)
    selectedCells.value=sel
  }
  function isColumnFullySelected(field:string){
    if(!records.value.length||!visibleColumns.value.includes(field)) return false
    return records.value.every((_,idx)=>selectedCells.value.includes(idx+'-'+field))
  }

  /* ----------- Fill Drag (省略注释，逻辑同上) ----------- */
  function onCellMouseDown(e:MouseEvent,f:string,r:number){
    if((e.target as HTMLElement).classList.contains('fill-handle')||(e.target as HTMLElement).classList.contains('resizer')) return
    if(e.button!==0) return
    dragCandidate.value=true; selectionStart.rowIndex=r; selectionStart.colIndex=fieldList.value.indexOf(f)
    mouseDownX.value=e.clientX; mouseDownY.value=e.clientY
    document.addEventListener('mousemove',onDragSelectMove)
    document.addEventListener('mouseup',onDragSelectUp)
  }
  function onDragSelectMove(e:MouseEvent){
    if(!dragCandidate.value||e.buttons!==1) return
    const dx=Math.abs(e.clientX-mouseDownX.value)+Math.abs(e.clientY-mouseDownY.value)
    if(dx>5) dragSelecting.value=true
    if(!dragSelecting.value) return
    const td=(e.target as HTMLElement).closest('td')
    if(!td) return
    const colClass=[...td.classList].find(c=>c.startsWith('column-'))
    if(!colClass) return
    const colIdx=letters.value.indexOf(colClass.replace('column-',''))
    if(colIdx<0) return
    const tr=td.closest('tr') as HTMLElement
    const id=tr?.dataset?.id
    if(!id) return
    const targetRow=records.value.findIndex(r=>String(r.id)===id)
    if(targetRow<0) return
    const startR=Math.min(selectionStart.rowIndex,targetRow), endR=Math.max(selectionStart.rowIndex,targetRow)
    const startC=Math.min(selectionStart.colIndex,colIdx), endC=Math.max(selectionStart.colIndex,colIdx)
    const newSel:string[]=[]
    for(let r=startR;r<=endR;r++)
      for(let c=startC;c<=endC;c++){
        const fld=fieldList.value[c]
        if(visibleColumns.value.includes(fld)) newSel.push(r+'-'+fld)
      }
    selectedCells.value=newSel
  }
  function onDragSelectUp(){
    document.removeEventListener('mousemove',onDragSelectMove)
    document.removeEventListener('mouseup',onDragSelectUp)
    dragCandidate.value=false; dragSelecting.value=false
  }

  /* ---------- 填充拖拽 ---------- */
  function startFillDrag(e:MouseEvent,r:number,f:string){
    fillDragging=true; fillSourceRow=r; fillSourceField=f; fillSourceColIndex=fieldList.value.indexOf(f)
    fillPreview.visible=false
    document.addEventListener('mousemove',onFillMove)
    document.addEventListener('mouseup',onFillEnd)
  }
  function onFillMove(e:MouseEvent){
    if(!fillDragging) return
    const td=document.elementFromPoint(e.clientX,e.clientY)?.closest('td')
    if(!td){ fillPreview.visible=false; return }
    const colClass=[...td.classList].find(c=>c.startsWith('column-'))
    if(!colClass){fillPreview.visible=false; return}
    const colIdx=letters.value.indexOf(colClass.replace('column-',''))
    if(colIdx<0){fillPreview.visible=false; return}
    const tr=td.closest('tr') as HTMLElement
    const id=tr?.dataset?.id
    if(!id){fillPreview.visible=false; return}
    const targetRow=records.value.findIndex(r=>String(r.id)===id)
    if(targetRow<0){fillPreview.visible=false; return}
    const sR=Math.min(fillSourceRow,targetRow), eR=Math.max(fillSourceRow,targetRow)
    const sC=Math.min(fillSourceColIndex,colIdx), eC=Math.max(fillSourceColIndex,colIdx)
    const rc1=getCellRect(sR,sC), rc2=getCellRect(eR,eC)
    if(!rc1||!rc2){fillPreview.visible=false;return}
    fillPreview.x=Math.min(rc1.left,rc2.left)
    fillPreview.y=Math.min(rc1.top,rc2.top)
    fillPreview.width =Math.max(rc1.right,rc2.right)-fillPreview.x
    fillPreview.height=Math.max(rc1.bottom,rc2.bottom)-fillPreview.y
    fillPreview.visible=true
  }
  function onFillEnd(e:MouseEvent){
    fillDragging=false
    document.removeEventListener('mousemove',onFillMove)
    document.removeEventListener('mouseup',onFillEnd)
    if(!fillPreview.visible){fillPreview.visible=false;return}
    fillPreview.visible=false
    const td=document.elementFromPoint(e.clientX,e.clientY)?.closest('td')
    if(!td) return
    const colClass=[...td.classList].find(c=>c.startsWith('column-'))
    if(!colClass) return
    const colIdx=letters.value.indexOf(colClass.replace('column-',''))
    if(colIdx<0) return
    const tr=td.closest('tr') as HTMLElement
    const id=tr?.dataset?.id
    if(!id) return
    const targetRow=records.value.findIndex(r=>String(r.id)===id)
    if(targetRow<0) return
    const sR=Math.min(fillSourceRow,targetRow), eR=Math.max(fillSourceRow,targetRow)
    const sC=Math.min(fillSourceColIndex,colIdx), eC=Math.max(fillSourceColIndex,colIdx)
    const val=records.value[fillSourceRow][fillSourceField]??''
    for(let r=sR;r<=eR;r++)
      for(let c=sC;c<=eC;c++){
        const fld=fieldList.value[c]
        if(!readOnlyFields.includes(fld)){ records.value[r][fld]=val; markModified(records.value[r].id) }
      }
  }
  function getCellRect(r:number,c:number){
    if(!tbodyRef.value) return null
    const row=tbodyRef.value.children[r] as HTMLElement
    if(!row) return null
    const td=row.children[c+baseOffset] as HTMLElement
    if(!td) return null
    const contRect=tableContainerRef.value!.getBoundingClientRect()
    const cellRect=td.getBoundingClientRect()
    return {
      left:cellRect.left-contRect.left+tableContainerRef.value!.scrollLeft,
      top :cellRect.top -contRect.top +tableContainerRef.value!.scrollTop,
      right:cellRect.right-contRect.left+tableContainerRef.value!.scrollLeft,
      bottom:cellRect.bottom-contRect.top+tableContainerRef.value!.scrollTop
    }
  }

  /* ================ 返回给组件 ================*/
  return {
    /* 原字段 */
    records,sortedRecords,uniqueValues,aliasMap,
    exactFilters,fuzzyFilters,modifiedIds,
    loading,showNotification,notificationMessage,notificationType,
    fieldList,letters,visibleColumns,visibleColumnsProxy,sortField,sortOrder,
    columnWidths,page,limit,total,
    statsCount,statsSum,statsAvg,
    selectedCells,dragSelecting,tbodyRef,tableContainerRef,fillPreview,fillPreviewStyles,highlightedRows,
    showEditFieldsModal,aliasForm,showConfirmModal,
    exactFilterDropdownOpen,
    currentExactField,
    exactFilterTempValues,
    exactDropdownPosition,
    colStyle,initResize,applyFilters,resetFilters,handleSort,
    openConfirmModal,closeConfirmModal,confirmUpdateAction,batchModify,
    deleteRecord,copyRecord,downloadCsv,addEmptyRow,
    markModified,onCellClick,onCellDblClick,onCellMouseDown,isCellSelected,
    copySelectedCells,pasteClipboardData,
    startFillDrag,onFillMove,onFillEnd,
    onColumnLetterClick,isColumnFullySelected,
    openEditFieldsModal,closeEditFieldsModal,saveFieldsAndAliases,
    openExactFilter,confirmExactFilter,cancelExactFilter,removeExactFilterItem,
    getAlias,getRowColor,readOnlyFields,numberFields,dateFields,
    colorDropdownOpen,currentFillColor,paletteColors,
    toggleColorDropdown,applyFillColor,getCellFillColor,
    colorFillWrapperRef,
    selectedRowIds,batchDelete,
    baseOffset
  }
}
