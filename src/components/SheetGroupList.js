import React, { Component } from 'react';
import SheetGroupHorizontal from './SheetGroupHorizontal'

export default class SheetGroupList extends React.Component {
    render(){
        return <div>
            <table>
                <tr>
                <SheetGroupHorizontal class = "s1"/>
                <SheetGroupHorizontal class = "s1"/>
                <SheetGroupHorizontal class = "s1"/>
        <SheetGroupHorizontal class = "s1"/>
        <SheetGroupHorizontal class = "s1"/>
        <SheetGroupHorizontal class = "s1"/>
        <SheetGroupHorizontal class = "s1"/>
 
                </tr>
            </table>
        
    
        </div>;
        
    }
}