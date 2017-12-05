Ext.define("CArABU.app.safeDeliveryMetrics", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new CArABU.technicalservices.Logger(),
    defaults: { margin: 10 },

    layout: {
    // layout-specific configs go here
      type: 'accordion',
      titleCollapse: false,
      animate: true,
      activeOnTop: true
    },
    integrationHeaders : {
        name : "CArABU.app.TSApp"
    },
    config: {
      defaultSettings: {
        daysOffsetFromIterationStart: 0,
        defectTag: null,
        daysOffsetFromPIStart: 0,
        precision: 2
      }
    },

    releaseFetchList: ['ObjectID','Project','Name','ReleaseStartDate','Children'],

    launch: function() {
      this.logger.log('this.', this._hasScope())
      if (!this._hasScope()){
        this._addAppMessage("This app is designed to run on a Release scoped dashboard.<br/><br/>Please select <em>Edit Page...</em> from the Page Settings and set the <em>Show Filter</em> setting to Release.");
        return;
      }
      this._update();
    },
    _update: function(){

       this.removeAll();
       var release = this.getReleaseTimeboxRecord();
       this.logger.log('_update ', release);
       if (!release){
           this._addAppMessage("Please select a Release.");
           return;
       }
       this.setLoading(true);
       Deft.Chain.pipeline([
         this._fetchIterations,
         this._fetchIterationRevisions,
         this._fetchReleases,
         this._fetchSnapshots
       ],this,{}).then({
          success: this._buildDisplay,
          failure: this._showErrorNotification,
          scope: this
       }).always(function(){
          this.setLoading(false);
       },this);
    },
    _showErrorNotification: function(msg){
       Rally.ui.notify.Notifier.showError({message: msg});
    },
    _fetchReleases: function(data){
        var deferred = Ext.create('Deft.Deferred');
        this.logger.log('_fetchReleases',data);
        var release = this.getReleaseTimeboxRecord(),
            filters = [{
              property: 'Name',
              value: release.get('Name')
            },{
              property: 'ReleaseStartDate',
              value: release.get('ReleaseStartDate')
            },{
              property: 'ReleaseDate',
              value: release.get('ReleaseDate')
            },{
              property: 'Project.Children.ObjectID',  //This is only going to get leaf projects
              value: ""
            }];

        Ext.create('Rally.data.wsapi.Store',{
           model: 'Release',
           filters: filters,
           fetch: this.releaseFetchList,
           limit: 'Infinity',
           pageSize: 2000
        }).load({
           callback: function(records,operation){
              if (operation.wasSuccessful()){
                data.releases = records;
                deferred.resolve(data);
              } else {
                deferred.reject('ERROR loading Releases: ' + operation.error && operation.error.errors.join(','));
              }
           }
        });

        return deferred.promise;
    },
    _fetchIterations: function(data){
      var deferred = Ext.create('Deft.Deferred');

      var release = this.getReleaseTimeboxRecord(),
          filters = [{
            property: 'EndDate',
            operator: '>',
            value: release.get('ReleaseStartDate')
          },{
            property: 'StartDate',
            operator: '<',
            value: release.get('ReleaseDate')
          },{
            property: 'Project.Children.ObjectID',
            value: ""
          }];

      Ext.create('Rally.data.wsapi.Store',{
         model: 'Iteration',
         filters: filters,
         fetch: ['ObjectID','Project','Name','StartDate','EndDate','RevisionHistory','PlannedVelocity','CreationDate'],
         limit: 'Infinity',
         pageSize: 2000
      }).load({
         callback: function(records,operation){
            if (operation.wasSuccessful()){
              data.iterations = records;
              deferred.resolve(data);
            } else {
              deferred.reject('ERROR loading ITerations: ' + operation.error && operation.error.errors.join(','));
            }
         }
      });

      return deferred.promise;
    },
    _fetchIterationRevisions: function(data){
      var deferred = Ext.create('Deft.Deferred');

      var filters = _.map(data.iterations, function(i){
          return {
             property: 'RevisionHistory.ObjectID',
             value: i.get('RevisionHistory').ObjectID
          };
      });
      filters = Rally.data.wsapi.Filter.or(filters);
      this.logger.log('filters', filters.toString());
      filters = filters.and({
          property: 'Description',
          operator: 'contains',
          value: 'PLANNED VELOCITY'
      });

      Ext.create('Rally.data.wsapi.Store',{
         model: 'Revision',
         filters: filters,
         fetch: ['ObjectID','RevisionHistory','Description','CreationDate'],
         limit: 'Infinity',
         pageSize: 2000,
         enablePostGet: true,
         sorters: [{
            property: 'CreationDate',
            direction: 'ASC'
         }]
      }).load({
         callback: function(records,operation){
            if (operation.wasSuccessful()){
              data.iterationRevisions = records;
              deferred.resolve(data);
            } else {
              deferred.reject('ERROR loading iteration revisions: ' + operation.error && operation.error.errors.join(','));
            }
         }
      });

      return deferred.promise;
    },
    _fetchSnapshots: function(data){
       var deferred = Ext.create('Deft.Deferred');
       var earliestDate = new Date('2999-01-01'),
          latestDate = new Date('1900-01-01'),
          timeboxOids = [];
       _.each(data.iterations, function(r){
          if (r.get('StartDate') < earliestDate){
             earliestDate = r.get('StartDate');
          }
          if (r.get('EndDate') > latestDate){
             latestDate = r.get('EndDate');
          }
          timeboxOids.push(r.get('ObjectID'));
       });
       this.logger.log('_fetchSnapshots -- ', timeboxOids, earliestDate, latestDate);

      //  var earliestDate = this.getReleaseTimeboxRecord().get('ReleaseStartDate'),
      //     latestDate = this.getReleaseTimeboxRecord().get('ReleaseDate');

       Ext.create('Rally.data.lookback.SnapshotStore',{
         fetch: ['ObjectID','Project','Iteration','PlanEstimate','AcceptedDate','Blocked','_ValidFrom','_ValidTo','_TypeHierarchy','Tags'],
         find:{
           "_TypeHierarchy": {$in: ['Defect','HierarchicalRequirement']},
           "Iteration": {$in: timeboxOids},
           "_ValidTo": {$gte: earliestDate},
           "_ValidFrom": {$lte: latestDate},
           "_ProjectHierarchy": this.getContext().getProject().ObjectID //This probably isn't needed since the iterations are specified
          },
          hydrate: ['_TypeHierarchy','Project'],
          limit: 'Infinity',
          removeUnauthorizedSnapshots: true,
          sort: { "_ValidFrom": 1 }
       }).load({
          callback: function(records, operation){
              if (operation.wasSuccessful()){
                  data.snapshots = records;
                  deferred.resolve(data);
              } else {
                  deferred.reject("Error loading snapshots: " + operation.error && operation.error.errors.join(','));
              }
          }
       });
       return deferred.promise;
    },
    _buildDisplay: function(data){
      this.logger.log('_buildDisplay',data);

      var items = [],
          newData = [],
          calcs = [];

      var releases = _.sortBy(data.releases, function(r){
         return r.get('Project').Name;
      });
      _.each(releases, function(r){
          var project = r.get('Project');
          var calc = Ext.create('CArABU.app.utils.teamMetricsCalculator',{
             project: project,
             release: r.getData(),
             iterations: data.iterations,
             snapshots: data.snapshots,
             iterationRevisions: data.iterationRevisions,
             daysOffsetFromIterationStart: this.getdaysOffsetFromIterationStart(),
             defectTag: this.getDefectTag()
          });

          //newData = newData.concat(calc.getData());
          items.push(this._addTeamGrid(calc.getData(), project.Name));
          calcs.push(calc);
      }, this);


      this.add({
        xtype:'panel',
        height: items.length * 400,
        autoScroll: true,
        cls: 'fieldBucket',
        flex: 1,
        itemId: 'teamDetail',
        tools:[{
            type: 'export',
            tooltip: 'Export Data',
            renderTpl: [
              '<div class="control icon-export" style="margin-right:20px"></div>'
            ],
            width: 35,
             handler: this._exportTeams,
             scope: this
        },{
          type:'close',
          tooltip: 'Collapse panel to see Summary data',
          renderTpl: [
            '<div class="control icon-chevron-down" style="margin-right:20px"></div>'
          ],
         renderSelectors: {
             toolEl: '.icon-chevron-down'
         },
         width: 35,
          handler: function(event, toolEl, panelHeader) {
            this.down('#teamDetail').collapse();
          },
          scope: this
        }],
        hideCollapseTool: true,
        padding: '8px 0 0 0',
        bodyPadding: '7px 5px 5px 5px',
        collapseDirection: 'top',
        collapsible: true,
        animCollapse: false,

        items: items,
        title: 'Teams',
      });

      this.add({
        xtype:'panel',
        height: 600,
        autoScroll: true,
        title: "Summary",
        //autoScroll: true,
        cls: 'fieldBucket',
        flex: 1,
        itemId: 'summary',
        tools:[{
            type: 'export',
            tooltip: 'Export Data',
            renderTpl: [
              '<div class="control icon-export" style="margin-right:20px"></div>'
            ],
            width: 35,
             handler: this._exportSummary,
             scope: this
        },{
          tooltip: 'Collapse panel to see team detail data',
          renderTpl: [
            '<div class="control icon-chevron-down" style="margin-right:20px"></div>'
          ],
         width: 35,
          handler: function(evt, toolEl, panelHeader, toolObj) {
            this.down('#summary').collapse();
          },
          scope: this
        }],
        hideCollapseTool: true,
        padding: '8px 0 0 0',
        bodyPadding: '7px 5px 5px 5px',
        collapseDirection: 'top',
        collapsible: true,
        animCollapse: false,
        items: [this._getSummaryGrid(calcs)]
      });

    },
    _exportTeams: function(){
      this.logger.log('_exportTeams');
      var grids = this.down('#teamDetail').query('rallygrid'),
          csv = [];
      _.each(grids, function(grid){
          var cols = grid.getColumnCfgs();
          var headers = ['Team'].concat(_.pluck(cols,'text'));
          csv.push('"' + headers.join('","') + '"');
          grid.getStore().each(function(r){
              var row = [grid.title];
              _.each(cols, function(c){
                 row.push(r.get(c.dataIndex));
              });
              csv.push(row.join(','));
          });
          csv.push("");
      });
      var fileName = Ext.String.format('team-detail-{0}.csv', Rally.util.DateTime.format(new Date(),'Y-m-d-h-i-s'));
      TSUtilities.saveCSVToFile(csv.join('\r\n'),fileName);
    },
    _exportSummary: function(){
      this.logger.log('_exportSummary');
      var grid = this.down('#summary').query('rallygrid'),
          csv = [];

      if (grid && grid.length > 0){
         grid = grid[0];
         var cols = grid.getColumnCfgs();
         var headers = _.pluck(cols,'text');
         csv.push('"' + headers.join('","') + '"');

         grid.getStore().each(function(r){
             var row = _.map(cols, function(c){
                return r.get(c.dataIndex);
             });
             csv.push(row.join(','));
         });
         var fileName = Ext.String.format('summary-{0}.csv', Rally.util.DateTime.format(new Date(),'Y-m-d-h-i-s'));
         TSUtilities.saveCSVToFile(csv.join('\r\n'),fileName);
      }
    },
    _getSummaryGrid: function(calcs){
      var newData = [];
      _.each(calcs, function(c){
         var project = c.project;
         newData.push({
           project: project.Name,
           pointsPlanned: c.getPlannedPointsTotal(),
           pointsAccepted: c.getAcceptedPointsTotal(),
           acceptanceRatio: c.getAcceptanceRatioTotal(),
           pointsAdded: c.getPointsAfterCommitmentTotal(),
           daysBlocked: c.getDaysBlockedTotal(),
           blockerResolution: c.getBlockerResolutionTotal(),
           defectsClosed: c.getDefectsClosedTotal(),
           piPlanVelocity: c.getPIPlanVelocityTotal(),
           piPlanLoad: c.getPIPlanLoadTotal()
         });
      });
      this.logger.log('data',newData);

      var store = Ext.create('Rally.data.custom.Store',{
             fields: Ext.Object.getKeys(newData[0]),
             data: newData,
             pageSize: newData.length
          });

        return Ext.widget({
          xtype:'rallygrid',
          store: store,
          features: [{
            ftype: 'summary'
          }],
          columnCfgs: this._getSummaryColumnCfgs(newData),
          showPagingToolbar: false,
          showRowActionsColumn: false
        });
    },
    _addTeamGrid: function(data, project){
      this.logger.log('_addTeamGrid', data);
      var fields = Ext.Object.getKeys(data[0]),
          store = Ext.create('Rally.data.custom.Store',{
             fields: fields,
             data: data,
             pageSize: data.length
          });

        return Ext.widget({
          xtype:'rallygrid',
          store: store,
          title: project,
          margin: '15 0 25 0',
          columnCfgs: this._getColumnCfgs(data),
          showPagingToolbar: false,
          showRowActionsColumn: false
        });
    },

    _getColumnCfgs: function(data){
        var cols = [{
           dataIndex: 'name',
           text: 'Metric',
           flex: 2
        }];
        var excludedKeys = ['name','key','project','total','isPercent'];
        this.logger.log('_getColumnCfgs', data);
        _.each(Ext.Object.getKeys(data[0]),function(key){
           if (!Ext.Array.contains(excludedKeys,key)){
             cols.push({
               dataIndex: key,
               text: key,
               renderer: this._numberRenderer,
               flex: 1
             });
           }
        }, this);
        cols.push({
          dataIndex: 'total',
          text: 'Total',
          renderer: this._numberRenderer,
          flex: 1
        });

        return cols;
    },

    _numberRenderer: function(v,m,r){
        if (r.get('isPercent') === true ){
            return Math.round(v*100) + '%';
        }

       if (!isNaN(v) && v % 1 !== 0){
          return v.toFixed(2);
       }
       return v;
    },
    _getSummaryColumnCfgs: function(data){
        var cols = [{
           dataIndex: 'project',
           text: 'Team',
           flex: 1,
           summaryType: 'count',
           summaryRenderer: function(value, summaryData, dataIndex) {
            return Ext.String.format('<div class="app-summary">{0} Team{1} Total</div>', value, value !== 1 ? 's' : '');
          }
        },{
           dataIndex: 'pointsPlanned',
           text: 'Points Planned',
           summaryType: 'sum'
        },{
           dataIndex: 'pointsAccepted',
           text: 'Points Accepted',
           summaryType: 'sum'
        },{
           dataIndex: 'acceptanceRatio',
           text: 'Point Acceptance Rate',
           renderer: function(v){
              return Math.round(v*100) + '%';
           },
           summaryType: 'average'
        },{
           dataIndex: 'daysBlocked',
           text: 'Days Blocked',
           summaryType: 'sum'
        },{
           dataIndex: 'blockerResolution',
           text: 'Average Days to Resolve Blockers',
           summaryType: 'average',
           renderer: this._numberRenderer
        },{
          dataIndex: 'defectsClosed',
          text: 'Total number of SIs Closed',
          summaryType: 'sum'
        },{
          dataIndex: 'piPlanVelocity',
          text: 'Total PI Plan Velocity',
          summaryType: 'sum'
        },{
          dataIndex: 'piPlanLoad',
          text: 'Total PI Plan Load',
          summaryType: 'sum'
        }];
        return cols;
    },
    _addAppMessage: function(msg){
        this.add({
           html: Ext.String.format('<div class="app-msg">{0}</div>',msg),
           xtype: 'panel',
           layout: 'fit',
           frameHeader: false,
           region: 'north'
        });
    },
    _hasScope: function() {
        var context = this.getContext();
        return context.getTimeboxScope() && context.getTimeboxScope().getType().toLowerCase() === 'release';
    },

    onTimeboxScopeChange: function(timebox){
        this.logger.log('onTimeboxScopeChange', timebox);
        if (timebox && timebox.type.toLowerCase() === 'release'){
            this.getContext().setTimeboxScope(timebox);
            this._update();
        }
    },
    getReleaseTimeboxRecord: function(){
        if (this._hasScope()){
            return (this.getContext().getTimeboxScope() && this.getContext().getTimeboxScope().getRecord()) || null;
        }
        return null;
    },
    getdaysOffsetFromIterationStart: function(){
        return this.getSetting('daysOffsetFromIterationStart');
    },
    getDefectTag: function(){
      return this.getSetting('defectTag');
    },
    getDaysOffsetFromPIStart: function(){
       return this.getSetting('daysOffsetFromPIStart');
    },
    getSettingsFields: function() {
        return [{
           name: 'daysOffsetFromIterationStart',
           xtype: 'rallynumberfield',
           minValue: 0,
           maxValue: 30,
           fieldLabel: 'Days Offset From Iteration Start',
           labelAlign: 'right',
           margin: 10,
           labelWidth: 200
        },{
          name: 'daysOffsetFromPIStart',
          xtype: 'rallynumberfield',
          minValue: 0,
          maxValue: 30,
          fieldLabel: 'Days Offset From PI Start',
          labelAlign: 'right',
          margin: 10,
          labelWidth: 200
        },{
         name: 'defectTag',
           xtype: 'rallytagpicker',
           fieldLabel: 'Defect Tag',
           labelAlign: 'right',
           labelWidth: 200,
           margin: '10 10 200 10'
        }];
    },

    getOptions: function() {
        var options = [
            {
                text: 'About...',
                handler: this._launchInfo,
                scope: this
            }
        ];

        return options;
    },

    _launchInfo: function() {
        if ( this.about_dialog ) { this.about_dialog.destroy(); }

        this.about_dialog = Ext.create('Rally.technicalservices.InfoLink',{
            showLog: this.getSetting('saveLog'),
            logger: this.logger
        });
    },

    isExternal: function(){
        return typeof(this.getAppId()) == 'undefined';
    }

});
