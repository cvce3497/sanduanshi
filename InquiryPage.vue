<script setup lang="ts">
import DataGrid from '@/components/DataGrid.vue'
import { type DataGridConfig } from '@/composables/useDataGrid'

/* ——— 询单页面专属配置 ——— */
const inquiryConfig: DataGridConfig = {
  apis: {
    query : '/api/ledger/sdpLedgerInquiryOrder/queryPageList',
    save  : '/api/ledger/sdpLedgerInquiryOrder/saveOrUpdate',
    remove: '/api/ledger/sdpLedgerInquiryOrder/deleteByIds',
    export: '/api/ledger/sdpLedgerInquiryOrder/exportPageList',
    color : '/api/ledger/sdpLedgerInquiryOrder/dataColorMark',
    alias : '/api/ledger/sdpLedgerInquiryOrder/definedHeaders',
    aliasQ: '/api/ledger/sdpLedgerUserConf/queryUserConf/1/1',
    colorQ: '/api/ledger/sdpLedgerUserConf/queryUserConf/1/2'
  },
  fieldList: [
    "id","createTime","createBy","updateTime","updateBy","inquiryOrderCode",
    "salesRegionCode","salesRegion","salesDepartCode","salesDepart","customerName",
    "country","salesDirectorId","salesDirector","salesSupportId","salesSupport",
    "moduleType","cableLength","moduleFrameSize","solarConnectors","moduleBom",
    "modulePower","cellCount","powerCount","requesteDeliveryTime","estimateReceiptTime",
    "plantApt","isCommittenApt","committenAptTime","remark","ext1","ext2","ext3","ext4",
    "ext5","ext6","ext7","ext8","ext9","ext10","delFlag","inquiryStatus"
  ],
  readOnly    : ["id","createTime","createBy","updateTime","updateBy","delFlag"],
  numberFields: ["cellCount","powerCount"],
  dateFields  : ["requesteDeliveryTime","estimateReceiptTime","committenAptTime"],
  pageSize    : 500
}
</script>

<template>
  <DataGrid title="线下询单填报‑历史记录" :config="inquiryConfig" />
</template>
